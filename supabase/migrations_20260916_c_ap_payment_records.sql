/* 外包应付付款登记（往来账销账闭环 第二部分，2026-09-16）
 *
 * 背景：
 *   外包记账（reset_outsource_finance）自动写 accounts_payable（pending），
 *   但事后给外包商付钱没有登记入口——paid_amount 永远是 0，应付只增不减。
 *
 * 设计（轻量版，仿客户收款单口径）：
 *   1. ap_payment_records 付款流水：按单据逐条登记（外包笔数少，不做"付款单+跨单核销"重型结构），
 *      带支付方式/付款账户/付款时间，留痕可作废
 *   2. 付款即销账：更新 accounts_payable.paid_amount/status（partial/paid）
 *   3. 写 finance_transactions（expense/其他支出），触发器自动扣资金账户余额；
 *      作废时删流水自动退回余额
 *   4. 权限：仅 admin/boss/accountant（与应收应付 RLS 收紧口径一致）
 *   5. 注意：外包应付付款【不写】 supplier_transactions——采购应付总账与外包应付是
 *      两套互不相通的账（payable 页面既定口径），写了会冲乱采购欠款
 *
 * 幂等三防：建表建索引 IF NOT EXISTS；函数 CREATE OR REPLACE；
 *           策略 DROP 再 CREATE；台账 ON CONFLICT DO NOTHING。
*/

/* ============================================================
   一、付款流水表
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.ap_payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id UUID NOT NULL REFERENCES public.accounts_payable(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT,                        /* 支付方式（复用 payment_methods 字典，存 name） */
  account_id UUID NOT NULL REFERENCES public.finance_accounts(id), /* 从哪个资金账户付出去（写流水用，必填） */
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), /* 实际付款时间（补录可改） */
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'voided')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID REFERENCES public.profiles(id),
  voided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ap_payment_records_payable ON public.ap_payment_records(payable_id);
CREATE INDEX IF NOT EXISTS idx_ap_payment_records_paid_at ON public.ap_payment_records(paid_at);
CREATE INDEX IF NOT EXISTS idx_ap_payment_records_status ON public.ap_payment_records(status);

/* ============================================================
   二、RLS：登录可读；写一律走 RPC（SECURITY DEFINER），不开客户端直写
   ============================================================ */
ALTER TABLE public.ap_payment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ap_payment_records_select ON public.ap_payment_records;
CREATE POLICY ap_payment_records_select ON public.ap_payment_records
  FOR SELECT TO authenticated USING (true);

/* ============================================================
   三、登记外包付款（事务）
   参数:
     p_payable_id      应付记录 id（必填）
     p_amount          本次付款金额（>0，≤ 未付余额）
     p_account_id      付款资金账户 id（必填，写 finance_transactions 用）
     p_payment_method  支付方式（可空）
     p_paid_at         实际付款时间（可空，默认当前）
     p_note            备注（可空）
   返回: { success, record_id, error? }
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_ap_payment(
  p_payable_id UUID,
  p_amount NUMERIC,
  p_account_id UUID,
  p_payment_method TEXT DEFAULT NULL,
  p_paid_at TIMESTAMPTZ DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap RECORD;
  v_record_id UUID;
  v_category_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:外包付款是财务口径，仅 管理员/老板/会计 可执行 */
  IF NOT public.has_role('admin', 'boss', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、会计可操作');
  END IF;

  IF p_payable_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '缺少应付记录');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '付款金额必须大于 0');
  END IF;
  IF p_account_id IS NULL OR NOT EXISTS (SELECT 1 FROM finance_accounts WHERE id = p_account_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择付款账户');
  END IF;

  /* 锁住目标应付记录（行锁即够，一张单据的付款天然串行） */
  SELECT ap.* INTO v_ap
  FROM accounts_payable ap
  WHERE ap.id = p_payable_id
  FOR UPDATE OF ap;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '应付记录不存在，请刷新后重试');
  END IF;
  IF v_ap.status NOT IN ('pending', 'partial') THEN
    RETURN jsonb_build_object('success', false, 'error', '该笔应付已结清或已取消，请刷新后重试');
  END IF;
  IF p_amount > v_ap.amount - COALESCE(v_ap.paid_amount, 0) THEN
    RETURN jsonb_build_object('success', false, 'error',
      '付款金额超过未付余额（剩 ' || TRIM(TO_CHAR(v_ap.amount - COALESCE(v_ap.paid_amount, 0), '999999990.00')) || ' 元），请刷新后重试');
  END IF;

  /* ── 插付款流水 ── */
  INSERT INTO ap_payment_records (payable_id, amount, payment_method, account_id, paid_at, note, created_by)
  VALUES (
    p_payable_id,
    p_amount,
    NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
    p_account_id,
    COALESCE(p_paid_at, NOW()),
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    auth.uid()
  )
  RETURNING id INTO v_record_id;

  /* ── 销账：paid_amount 累加，状态自动推进 ── */
  UPDATE accounts_payable
  SET paid_amount = COALESCE(paid_amount, 0) + p_amount,
      status = CASE
        WHEN COALESCE(paid_amount, 0) + p_amount >= amount THEN 'paid'
        ELSE 'partial'
      END,
      updated_at = NOW()
  WHERE id = p_payable_id;

  /* ── 写财务流水（expense/其他支出；触发器自动扣账户余额） ── */
  SELECT id INTO v_category_id
  FROM finance_categories
  WHERE type = 'expense' AND name = '其他支出'
  LIMIT 1;

  INSERT INTO finance_transactions (
    account_id, category_id, type, amount,
    related_type, related_id, description, transaction_date, created_by
  ) VALUES (
    p_account_id, v_category_id, 'expense', p_amount,
    'other', v_record_id,
    '外包付款（' || COALESCE(v_ap.notes, '应付单') || '）',
    COALESCE(p_paid_at, NOW())::DATE,
    auth.uid()
  );

  RETURN jsonb_build_object('success', true, 'record_id', v_record_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_ap_payment(uuid, numeric, uuid, text, timestamptz, text) FROM anon, PUBLIC;

/* ============================================================
   四、作废外包付款（事务）：流水留痕 + 应付回滚 + 删财务流水
   ============================================================ */
CREATE OR REPLACE FUNCTION public.void_ap_payment(p_record_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、会计可操作');
  END IF;

  SELECT * INTO v_record FROM ap_payment_records WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '付款记录不存在');
  END IF;
  IF v_record.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', '该付款记录已作废，请勿重复操作');
  END IF;

  /* 回滚应付（先锁应付行再回退） */
  PERFORM 1 FROM accounts_payable WHERE id = v_record.payable_id FOR UPDATE;

  UPDATE accounts_payable
  SET paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_record.amount),
      status = CASE
        WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_record.amount) <= 0 THEN 'pending'
        WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_record.amount) >= amount THEN 'paid'
        ELSE 'partial'
      END,
      updated_at = NOW()
  WHERE id = v_record.payable_id;

  /* 删财务流水（触发器自动退回账户余额）；related_id 是本付款记录 id，精确匹配不误删 */
  DELETE FROM finance_transactions
  WHERE related_type = 'other' AND related_id = v_record.id;

  UPDATE ap_payment_records
  SET status = 'voided', voided_by = auth.uid(), voided_at = NOW()
  WHERE id = p_record_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.void_ap_payment(uuid) FROM anon, PUBLIC;

/* ============================================================
   五、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260916_c_ap_payment_records.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新表和策略:
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename = 'ap_payment_records';
      应返回 1 行（select 策略）。
   2. 两个函数存在:
      SELECT proname FROM pg_proc
      WHERE proname IN ('create_ap_payment', 'void_ap_payment');
      应返回 2 行。
*/
