/* 款项增强项（供应商款项+物流款项改造 批次5，2026-09-15）
 *
 * 内容（全是新增，不动现有流程）:
 *   1. 退货运费入物流往来账：purchase_return_orders 加 freight_recorded 标记 +
 *      record_return_freight_payable RPC（payer=self 且运费>0 时，按物流名匹配公司
 *      记一条 logistics_transactions debit；默认不记，用户在采退单详情手动点）
 *   2. 代收货款转付核对：logistics_waybills 加 cod_transferred/cod_transferred_at +
 *      mark_waybill_cod_transferred RPC（货运站把代收款转给供应商后，一键打标）
 *
 * 幂等三防：加列 IF NOT EXISTS；函数 CREATE OR REPLACE；台账 ON CONFLICT。
*/

/* ============================================================
   一、采退单加"运费已入账"标记
   ============================================================ */
ALTER TABLE public.purchase_return_orders ADD COLUMN IF NOT EXISTS freight_recorded BOOLEAN NOT NULL DEFAULT false;

/* ============================================================
   二、退货运费记入物流应付（事务）
   场景：退货的运费由店里承担（shipping_fee_payer='self'），这笔钱是
        付给物流公司的，此前只记在采退单字段里不对账。
   设计：默认不自动记（保持现状），用户在采退单详情手动点"记入物流应付"。
   ============================================================ */
CREATE OR REPLACE FUNCTION public.record_return_freight_payable(p_return_order_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ro RECORD;
  v_company_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:与物流款项写操作同口径 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_ro FROM purchase_return_orders WHERE id = p_return_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采退单不存在');
  END IF;
  IF v_ro.freight_recorded THEN
    RETURN jsonb_build_object('success', false, 'error', '该采退单的运费已入过账，请勿重复操作');
  END IF;
  IF COALESCE(v_ro.return_shipping_fee, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '该采退单没有退货运费');
  END IF;
  IF v_ro.shipping_fee_payer <> 'self' THEN
    RETURN jsonb_build_object('success', false, 'error', '运费由供应商承担，不需要店里入账');
  END IF;
  IF NULLIF(BTRIM(COALESCE(v_ro.logistics_company, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '采退单没填物流公司，无法入账');
  END IF;

  /* 采退单的 logistics_company 是名字快照，按名匹配物流公司档案 */
  SELECT id INTO v_company_id FROM logistics_companies WHERE name = BTRIM(v_ro.logistics_company) LIMIT 1;
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error',
      '找不到名为「' || v_ro.logistics_company || '」的物流公司档案，请先在物流页建档');
  END IF;

  INSERT INTO logistics_transactions (
    logistics_company_id, transaction_type, amount, description,
    reference_id, reference_type, created_by
  ) VALUES (
    v_company_id, 'debit', v_ro.return_shipping_fee,
    '退货运费(采退单 ' || COALESCE(v_ro.return_no, '') || ')',
    p_return_order_id, 'purchase_return_order', auth.uid()
  );

  UPDATE purchase_return_orders SET freight_recorded = true WHERE id = p_return_order_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.record_return_freight_payable(uuid) FROM anon, PUBLIC;

/* ============================================================
   三、运单加"代收货款已转付"核对字段
   场景：代收货款由货运站转付给供应商，此前默认信任、无核对状态。
   ============================================================ */
ALTER TABLE public.logistics_waybills ADD COLUMN IF NOT EXISTS cod_transferred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.logistics_waybills ADD COLUMN IF NOT EXISTS cod_transferred_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_waybill_cod_transferred(p_waybill_id UUID)
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
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_wb FROM logistics_waybills WHERE id = p_waybill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '运单不存在');
  END IF;
  IF COALESCE(v_wb.cod_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '该运单没有代收货款');
  END IF;
  IF v_wb.cod_transferred THEN
    RETURN jsonb_build_object('success', false, 'error', '该运单代收货款已标记转付，请勿重复操作');
  END IF;

  UPDATE logistics_waybills
  SET cod_transferred = true, cod_transferred_at = NOW()
  WHERE id = p_waybill_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.mark_waybill_cod_transferred(uuid) FROM anon, PUBLIC;

/* ============================================================
   四、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_d_payment_enhancements.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新列:
      SELECT column_name FROM information_schema.columns
      WHERE (table_name = 'purchase_return_orders' AND column_name = 'freight_recorded')
         OR (table_name = 'logistics_waybills' AND column_name IN ('cod_transferred', 'cod_transferred_at'));
      应返回 3 行。
   2. 新函数:
      SELECT proname FROM pg_proc
      WHERE proname IN ('record_return_freight_payable', 'mark_waybill_cod_transferred');
      应返回 2 行。
   ============================================================
*/
