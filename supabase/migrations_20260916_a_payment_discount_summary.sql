/* 付款优惠 + 供应商汇总列（批次6，2026-09-16）
 *
 * 背景（参考开思1号车间供应商款项页，用户拍板）：
 *   1. 付款优惠：付 980 抹掉 1000 的账，20 记"优惠"——汽修行业常见。
 *      优惠不是真付钱（不能记 payment），新账目类型 discount（减欠款，与 credit 同向）。
 *   2. 供应商汇总表：按供应商看 累计进货/累计已付/累计退货/欠款余额 一张表。
 *
 * 内容：
 *   1. supplier_payments 加 discount_amount 列（默认 0）；amount 约束放宽为 >=0（允许纯优惠单）
 *   2. supplier_transactions 类型 CHECK 加 'discount'
 *   3. create_supplier_payment 改参数列表（加 p_discount_amount）——【DROP 再 CREATE，三防】
 *      额度校验口径变为：核销合计 ≤ 来源池 − 已核销 + 本单(实付+优惠)
 *      事务内：优惠>0 时多写一条 discount 流水（减欠款）
 *   4. void_supplier_payment 作废时连同 discount 流水一起删（CREATE OR REPLACE）
 *   5. list_supplier_payables 余额公式减 discount（CREATE OR REPLACE）
 *   6. supplier_balances 返回结构加累计列——【DROP 再 CREATE】，余额公式同步减 discount
 *
 * 余额总公式（全局新口径）：欠款 = debit + refund − payment − credit − discount
*/

/* ============================================================
   一、付款单加优惠列 + 金额约束放宽（纯优惠单允许实付 0）
   ============================================================ */
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_amount_check;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_amount_check CHECK (amount >= 0);

/* ============================================================
   二、往来账类型 CHECK 加 'discount'（优惠：供应商少收的钱，减欠款）
   ============================================================ */
ALTER TABLE public.supplier_transactions DROP CONSTRAINT IF EXISTS supplier_transactions_transaction_type_check;
ALTER TABLE public.supplier_transactions ADD CONSTRAINT supplier_transactions_transaction_type_check
  CHECK (transaction_type IN ('payment', 'refund', 'credit', 'debit', 'discount'));

/* ============================================================
   三、create_supplier_payment：加 p_discount_amount 参数
   【改参数列表，先 DROP 再 CREATE（三防规矩，防重载残留）】
   ============================================================ */
DROP FUNCTION IF EXISTS public.create_supplier_payment(uuid, numeric, text, timestamptz, text, jsonb);

CREATE FUNCTION public.create_supplier_payment(
  p_supplier_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT NULL,
  p_paid_at TIMESTAMPTZ DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_allocations JSONB DEFAULT '[]'::JSONB,
  p_discount_amount NUMERIC DEFAULT 0
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
  v_payment_no TEXT;
  v_alloc RECORD;
  v_tx RECORD;
  v_tids UUID[] := '{}';
  v_amts NUMERIC[] := '{}';
  v_alloc_total NUMERIC(12,2) := 0;
  v_pool NUMERIC(12,2);
  v_allocated NUMERIC(12,2);
  i INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:供应商款项写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择供应商');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '供应商不存在');
  END IF;
  /* 实付和优惠都必须非负，且至少一项大于 0（2026-09-16 批次6：允许纯优惠抹零单） */
  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '付款金额不能为负');
  END IF;
  IF p_discount_amount IS NULL OR p_discount_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '优惠金额不能为负');
  END IF;
  IF p_amount + p_discount_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '付款金额和优惠金额至少一项要大于 0');
  END IF;

  /* 同一供应商的付款串行化：防两个窗口同时付款导致超勾 */
  PERFORM pg_advisory_xact_lock(hashtext(p_supplier_id::TEXT));

  /* ── 逐笔校验核销明细（同一张应付在本单内合并后校验） ── */
  FOR v_alloc IN
    SELECT (elem->>'transaction_id')::UUID AS tid, SUM((elem->>'amount')::NUMERIC) AS amt
    FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::JSONB)) elem
    GROUP BY 1
  LOOP
    IF v_alloc.amt IS NULL OR v_alloc.amt <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', '核销金额必须大于 0');
    END IF;

    SELECT st.* INTO v_tx
    FROM supplier_transactions st
    WHERE st.id = v_alloc.tid
    FOR UPDATE OF st;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '核销的应付记录不存在，请刷新后重试');
    END IF;
    IF v_tx.transaction_type <> 'debit' THEN
      RETURN jsonb_build_object('success', false, 'error', '只能核销"应付"类型的往来记录');
    END IF;
    IF v_tx.supplier_id <> p_supplier_id THEN
      RETURN jsonb_build_object('success', false, 'error', '核销记录不属于该供应商');
    END IF;

    IF v_alloc.amt > v_tx.amount - COALESCE((
      SELECT SUM(a.amount) FROM supplier_payment_allocations a
      JOIN supplier_payments p ON p.id = a.payment_id
      WHERE a.transaction_id = v_tx.id AND p.status = 'confirmed'
    ), 0) THEN
      RETURN jsonb_build_object('success', false, 'error',
        '核销金额超过该笔应付的未付余额（入库单 ' || COALESCE(v_tx.description, '') || '），请刷新后重试');
    END IF;

    v_tids := v_tids || v_alloc.tid;
    v_amts := v_amts || v_alloc.amt;
    v_alloc_total := v_alloc_total + v_alloc.amt;
  END LOOP;

  /* ── 全局核销额度校验：来源池 − 已核销 + 本单(实付+优惠) ≥ 本单核销合计 ── */
  SELECT COALESCE(SUM(amount), 0) INTO v_pool
  FROM supplier_payments
  WHERE supplier_id = p_supplier_id AND status = 'confirmed';
  SELECT v_pool + COALESCE(SUM(amount), 0) INTO v_pool
  FROM supplier_transactions
  WHERE supplier_id = p_supplier_id AND transaction_type = 'payment'
    AND (reference_type IS NULL OR reference_type <> 'supplier_payment');

  SELECT COALESCE(SUM(a.amount), 0) INTO v_allocated
  FROM supplier_payment_allocations a
  JOIN supplier_payments p ON p.id = a.payment_id
  WHERE p.supplier_id = p_supplier_id AND p.status = 'confirmed';

  IF v_alloc_total > v_pool - v_allocated + p_amount + p_discount_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      '核销合计 ' || TRIM(TO_CHAR(v_alloc_total, '999999990.00')) ||
      ' 元超过可核销额度（历史付款余额 ' || TRIM(TO_CHAR(v_pool - v_allocated, '999999990.00')) ||
      ' 元 + 本次付款 ' || TRIM(TO_CHAR(p_amount, '999999990.00')) ||
      ' 元 + 本次优惠 ' || TRIM(TO_CHAR(p_discount_amount, '999999990.00')) || ' 元）');
  END IF;

  /* ── 建付款单（单号触发器生成） ── */
  INSERT INTO supplier_payments (supplier_id, amount, discount_amount, payment_method, paid_at, note, created_by)
  VALUES (
    p_supplier_id,
    p_amount,
    p_discount_amount,
    NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
    COALESCE(p_paid_at, NOW()),
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    auth.uid()
  )
  RETURNING id, payment_no INTO v_payment_id, v_payment_no;

  /* ── 写核销明细 ── */
  FOR i IN 1..COALESCE(array_length(v_tids, 1), 0) LOOP
    INSERT INTO supplier_payment_allocations (payment_id, transaction_id, amount)
    VALUES (v_payment_id, v_tids[i], v_amts[i]);
  END LOOP;

  /* ── 写 payment 流水（实付>0 才写） ── */
  IF p_amount > 0 THEN
    INSERT INTO supplier_transactions (
      supplier_id, transaction_type, amount, description,
      reference_id, reference_type, payment_method, created_by
    ) VALUES (
      p_supplier_id, 'payment', p_amount,
      '付款单 ' || v_payment_no,
      v_payment_id, 'supplier_payment',
      NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
      auth.uid()
    );
  END IF;

  /* ── 写 discount 流水（优惠>0 才写；减欠款，与 credit 同向） ── */
  IF p_discount_amount > 0 THEN
    INSERT INTO supplier_transactions (
      supplier_id, transaction_type, amount, description,
      reference_id, reference_type, created_by
    ) VALUES (
      p_supplier_id, 'discount', p_discount_amount,
      '付款优惠(付款单 ' || v_payment_no || ')',
      v_payment_id, 'supplier_payment',
      auth.uid()
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'payment_no', v_payment_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_supplier_payment(uuid, numeric, text, timestamptz, text, jsonb, numeric) FROM anon, PUBLIC;

/* ============================================================
   四、void_supplier_payment：作废时连同 discount 流水一起删
   ============================================================ */
CREATE OR REPLACE FUNCTION public.void_supplier_payment(p_payment_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_payment FROM supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '付款单不存在');
  END IF;
  IF v_payment.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', '该付款单已作废，请勿重复操作');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_payment.supplier_id::TEXT));

  UPDATE supplier_payments
  SET status = 'voided', voided_by = auth.uid(), voided_at = NOW()
  WHERE id = p_payment_id;

  DELETE FROM supplier_payment_allocations WHERE payment_id = p_payment_id;

  /* 2026-09-16 批次6：付款流水和优惠流水一起删 */
  DELETE FROM supplier_transactions
  WHERE reference_type = 'supplier_payment'
    AND reference_id = p_payment_id
    AND transaction_type IN ('payment', 'discount');

  RETURN jsonb_build_object('success', true, 'payment_no', v_payment.payment_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.void_supplier_payment(uuid) FROM anon, PUBLIC;

/* ============================================================
   五、list_supplier_payables：余额公式减 discount
   ============================================================ */
CREATE OR REPLACE FUNCTION public.list_supplier_payables(p_supplier_id UUID)
RETURNS JSONB
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payables JSONB;
  v_pool NUMERIC(12,2);
  v_allocated NUMERIC(12,2);
  v_balance NUMERIC(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY tx_created_at ASC), '[]'::JSONB)
  INTO v_payables
  FROM (
    SELECT jsonb_build_object(
      'transaction_id', st.id,
      'amount', st.amount,
      'allocated', COALESCE(agg.allocated, 0),
      'remaining', st.amount - COALESCE(agg.allocated, 0),
      'created_at', st.created_at,
      'description', st.description,
      'inbound_order_id', io.id,
      'inbound_no', io.inbound_no,
      'supplier_order_no', io.supplier_order_no
    ) AS row_data,
    st.created_at AS tx_created_at
    FROM supplier_transactions st
    LEFT JOIN (
      SELECT a.transaction_id, SUM(a.amount) AS allocated
      FROM supplier_payment_allocations a
      JOIN supplier_payments p ON p.id = a.payment_id
      WHERE p.status = 'confirmed'
      GROUP BY a.transaction_id
    ) agg ON agg.transaction_id = st.id
    LEFT JOIN inbound_orders io
      ON st.reference_type = 'inbound_order' AND st.reference_id = io.id
    WHERE st.supplier_id = p_supplier_id AND st.transaction_type = 'debit'
  ) t;

  SELECT COALESCE(SUM(amount), 0) INTO v_pool
  FROM supplier_payments WHERE supplier_id = p_supplier_id AND status = 'confirmed';
  SELECT v_pool + COALESCE(SUM(amount), 0) INTO v_pool
  FROM supplier_transactions
  WHERE supplier_id = p_supplier_id AND transaction_type = 'payment'
    AND (reference_type IS NULL OR reference_type <> 'supplier_payment');

  SELECT COALESCE(SUM(a.amount), 0) INTO v_allocated
  FROM supplier_payment_allocations a
  JOIN supplier_payments p ON p.id = a.payment_id
  WHERE p.supplier_id = p_supplier_id AND p.status = 'confirmed';

  /* 2026-09-16 批次6：余额公式减 discount（优惠减欠款） */
  SELECT COALESCE(SUM(CASE transaction_type
      WHEN 'debit' THEN amount
      WHEN 'payment' THEN -amount
      WHEN 'credit' THEN -amount
      WHEN 'refund' THEN amount
      WHEN 'discount' THEN -amount
      ELSE 0 END), 0)
  INTO v_balance
  FROM supplier_transactions
  WHERE supplier_id = p_supplier_id;

  RETURN jsonb_build_object(
    'success', true,
    'payables', v_payables,
    'pool', v_pool,
    'allocated', v_allocated,
    'available', v_pool - v_allocated,
    'balance', v_balance
  );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.list_supplier_payables(uuid) FROM anon, PUBLIC;

/* ============================================================
   六、supplier_balances：返回加累计列 + 余额公式减 discount
   【改返回结构，先 DROP 再 CREATE（三防规矩）】
   ============================================================ */
DROP FUNCTION IF EXISTS public.supplier_balances();

CREATE FUNCTION public.supplier_balances()
RETURNS TABLE(
  supplier_id UUID,
  supplier_name TEXT,
  balance NUMERIC,
  inbound_count BIGINT,
  total_debit NUMERIC,
  total_payment NUMERIC,
  total_credit NUMERIC
)
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id, s.name,
    COALESCE(SUM(CASE t.transaction_type
      WHEN 'debit' THEN t.amount
      WHEN 'refund' THEN t.amount
      WHEN 'payment' THEN -t.amount
      WHEN 'credit' THEN -t.amount
      WHEN 'discount' THEN -t.amount
      ELSE 0 END), 0)::NUMERIC(12,2) AS balance,
    COUNT(t.id) FILTER (WHERE t.transaction_type = 'debit') AS inbound_count,
    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'debit'), 0)::NUMERIC(12,2) AS total_debit,
    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'payment'), 0)::NUMERIC(12,2) AS total_payment,
    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'credit'), 0)::NUMERIC(12,2) AS total_credit
  FROM suppliers s
  LEFT JOIN supplier_transactions t ON t.supplier_id = s.id
  GROUP BY s.id, s.name
  ORDER BY balance DESC;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.supplier_balances() FROM anon, PUBLIC;

/* ============================================================
   七、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260916_a_payment_discount_summary.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新列:
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'supplier_payments' AND column_name = 'discount_amount';
      应返回 1 行。
   2. 旧签名函数已消失（防重载残留）:
      SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='create_supplier_payment' AND p.pronargs=6;
      应返回 0；pronargs=7 应返回 1。
   3. discount 类型可用:
      SELECT conname FROM pg_constraint WHERE conname = 'supplier_transactions_transaction_type_check';
      应返回 1 行（定义含 discount）。
   ============================================================
*/
