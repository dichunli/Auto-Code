/* 物流公司运费应付款（待收货改造三期补充，2026-08-20）
 *
 * 拍板决策（用户原话）："运单有运费金额的应该生成对物流公司的应付款"
 *
 * 设计：
 *   1. 新表 logistics_transactions：物流公司往来账，口径同 supplier_transactions
 *      debit=应付运费 / payment=已付运费，余额=debit−payment
 *   2. 触发器 fn_waybill_freight_payable：运单状态变 received（签收）时，
 *      有运费且有物流公司 → 自动生成 debit（一张运单只记一次）。
 *      用触发器而不用函数内调用：新流程（到货确认）和老流程（采购单收齐）都会把运单
 *      置 received，触发器一处覆盖两条路径，不用改稳定的 receive_purchase_item
 *   3. settle_waybill_freight RPC：结清=记 payment + 运单打 freight_settled 标，一个事务
 *
 * 与 migrations_20260820_arrival_settlement.sql 的关系：
 *   那个文件加的 freight_settled 标记保留（列表快速筛选用），本文件补上真正的往来账。
*/

/* ============================================================
   一、物流公司往来账
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.logistics_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  logistics_company_id UUID NOT NULL REFERENCES public.logistics_companies(id),
  transaction_type TEXT NOT NULL,          /* debit 应付运费 / payment 已付运费 */
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  reference_id UUID,                       /* 关联运单 */
  reference_type TEXT,                     /* logistics_waybill */
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logistics_tx_company ON public.logistics_transactions(logistics_company_id);
CREATE INDEX IF NOT EXISTS idx_logistics_tx_reference ON public.logistics_transactions(reference_id);

ALTER TABLE public.logistics_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logistics_transactions_select ON public.logistics_transactions;
DROP POLICY IF EXISTS logistics_transactions_insert ON public.logistics_transactions;
DROP POLICY IF EXISTS logistics_transactions_update ON public.logistics_transactions;
DROP POLICY IF EXISTS logistics_transactions_delete ON public.logistics_transactions;

CREATE POLICY logistics_transactions_select ON public.logistics_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY logistics_transactions_insert ON public.logistics_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY logistics_transactions_update ON public.logistics_transactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY logistics_transactions_delete ON public.logistics_transactions FOR DELETE TO authenticated USING (true);

/* ============================================================
   二、运单签收触发器：自动生成对物流公司的运费应付款
   ============================================================ */
CREATE OR REPLACE FUNCTION public.fn_waybill_freight_payable()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  /* 只在"变成已签收"那一刻触发；运费>0；有物流公司；同一张运单只记一次 */
  IF NEW.status = 'received'
     AND OLD.status IS DISTINCT FROM 'received'
     AND COALESCE(NEW.freight_amount, 0) > 0
     AND NEW.logistics_company_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM logistics_transactions
       WHERE reference_id = NEW.id AND reference_type = 'logistics_waybill'
     ) THEN
    INSERT INTO logistics_transactions (
      logistics_company_id, transaction_type, amount, description,
      reference_id, reference_type, created_by
    ) VALUES (
      NEW.logistics_company_id, 'debit', NEW.freight_amount,
      '运费(运单 ' || COALESCE(NEW.tracking_no, '') || ')',
      NEW.id, 'logistics_waybill', auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_waybill_freight_payable ON public.logistics_waybills;
CREATE TRIGGER trg_waybill_freight_payable
  AFTER UPDATE OF status ON public.logistics_waybills
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_waybill_freight_payable();

/* ============================================================
   三、结清运费：记 payment + 运单打标，一个事务
   ============================================================ */
CREATE OR REPLACE FUNCTION public.settle_waybill_freight(p_waybill_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wb RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商/物流写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_wb FROM logistics_waybills WHERE id = p_waybill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '运单不存在');
  END IF;
  IF COALESCE(v_wb.freight_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '该运单没有运费金额');
  END IF;
  IF v_wb.freight_settled THEN
    RETURN jsonb_build_object('success', false, 'error', '该运单运费已结清，请勿重复操作');
  END IF;

  /* 已付运费（应付不存在时也允许直接记付款，兼容没走签收流程的运单） */
  IF v_wb.logistics_company_id IS NOT NULL THEN
    INSERT INTO logistics_transactions (
      logistics_company_id, transaction_type, amount, description,
      reference_id, reference_type, created_by
    ) VALUES (
      v_wb.logistics_company_id, 'payment', v_wb.freight_amount,
      '运费结清(运单 ' || COALESCE(v_wb.tracking_no, '') || ')',
      v_wb.id, 'logistics_waybill', auth.uid()
    );
  END IF;

  UPDATE logistics_waybills
  SET freight_settled = true, freight_settled_at = NOW()
  WHERE id = p_waybill_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.settle_waybill_freight(uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新表和策略:
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename = 'logistics_transactions';
      应返回 4 行。
   2. 触发器就位:
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.logistics_waybills'::regclass
        AND tgname = 'trg_waybill_freight_payable';
      应返回 1 行。
   3. 结清函数带门禁:
      SELECT proname FROM pg_proc
      WHERE proname = 'settle_waybill_freight'
        AND pg_get_functiondef(oid) LIKE '%权限门禁%';
      应返回 1 行。
*/
