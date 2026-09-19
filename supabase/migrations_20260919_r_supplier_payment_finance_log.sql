/* ============================================================
 * 供应商付款/退款补记财务流水（2026-09-19，严谨性整改阶段一 · 任务5）
 *
 * 问题（诊断实锤）：
 *   采购付款是全系统最大的现金流出，供应商退款是现金流入，
 *   但 create_supplier_payment / create_supplier_receipt 只记供应商往来账，
 *   不写 finance_transactions —— 收支流水页、资金账户余额、今日支出
 *   全部看不到采购付款，现金账与实际银行流水永远对不上。
 *
 * 方案（基于 0916_a / 0917_a 的最终生效版本改造，单事务内补记）：
 *   1. 新增两个资金往来科目（counts_in_profit=FALSE，防利润双计）：
 *      采购付款（expense）：进货是资产不是费用，利润在配件领用时经配件成本体现；
 *      采购退款（income）：退货回款，与采购付款对称。
 *   2. create_supplier_payment：实付>0 时补记 expense/采购付款 流水
 *      （纯优惠抹零单 p_amount=0 无现金流动，不记）；账户按支付方式解析。
 *   3. void_supplier_payment：作废时删对应流水（触发器自动回加余额），
 *      与现有"作废=删往来流水"风格一致。
 *   4. create_supplier_receipt：补记 income/采购退款 流水。
 *   5. void_supplier_receipt：作废时删对应流水。
 *
 * 已知遗留（不在本次范围）：供应商手工记一笔（supplier_transactions 直插）
 *   仍不写财务流水，列入阶段四统一口径时处理。
 * 历史存量：迁移前的付款/退款没有流水，属阶段五存量清洗范围。
 * 幂等：全部 CREATE OR REPLACE（参数列表未变），重跑无害。
 * ============================================================ */

/* ─── 一、两个资金往来科目（不计入利润，防双计） ─── */
INSERT INTO finance_categories (name, type, sort_order, counts_in_profit)
SELECT '采购付款', 'expense', 11, FALSE
WHERE NOT EXISTS (SELECT 1 FROM finance_categories WHERE type = 'expense' AND name = '采购付款');

INSERT INTO finance_categories (name, type, sort_order, counts_in_profit)
SELECT '采购退款', 'income', 12, FALSE
WHERE NOT EXISTS (SELECT 1 FROM finance_categories WHERE type = 'income' AND name = '采购退款');

/* ─── 二、创建付款单：实付>0 补记 expense/采购付款 流水 ───
   （基于 0916_a 七参最终版，逻辑逐行保留，仅追加流水段） */
CREATE OR REPLACE FUNCTION public.create_supplier_payment(
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
  v_account_id UUID;
  v_category_id UUID;
  i INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:供应商款项写操作仅 管理员/老板/仓管 可执行（与往来账 RLS 口径一致） */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择供应商');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '供应商不存在');
  END IF;
  /* 实付和优惠都必须非负，且至少一项大于 0（允许纯优惠抹零单） */
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

    /* ── 补记财务流水（expense/采购付款；触发器自动扣账户余额）。
       科目 counts_in_profit=FALSE：进货是资产，利润在配件领用时经成本体现。
       找不到账户宁可失败也不允许丢流水（钱已付出去了） ── */
    v_account_id := public.fn_finance_account_for_method(p_payment_method);
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION '未找到可用资金账户，请先在财务管理中建立账户';
    END IF;
    SELECT id INTO v_category_id FROM finance_categories
    WHERE type = 'expense' AND name = '采购付款'
    ORDER BY created_at LIMIT 1;

    INSERT INTO finance_transactions (
      account_id, category_id, type, amount,
      related_type, related_id, description, transaction_date, created_by
    ) VALUES (
      v_account_id, v_category_id, 'expense', p_amount,
      'supplier_payment', v_payment_id,
      '供应商付款 ' || v_payment_no,
      COALESCE(p_paid_at, NOW())::DATE,
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

/* ─── 三、作废付款单：连同财务流水一起删（触发器自动回加余额） ─── */
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

  /* 付款流水和优惠流水一起删 */
  DELETE FROM supplier_transactions
  WHERE reference_type = 'supplier_payment'
    AND reference_id = p_payment_id
    AND transaction_type IN ('payment', 'discount');

  /* 财务流水同步删（触发器自动回加账户余额） */
  DELETE FROM finance_transactions
  WHERE related_type = 'supplier_payment'
    AND related_id = p_payment_id;

  RETURN jsonb_build_object('success', true, 'payment_no', v_payment.payment_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ─── 四、创建收款单：补记 income/采购退款 流水 ─── */
CREATE OR REPLACE FUNCTION public.create_supplier_receipt(
  p_supplier_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_receipt_id UUID;
  v_receipt_no TEXT;
  v_balance NUMERIC(12,2);
  v_account_id UUID;
  v_category_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:供应商款项写操作仅 管理员/老板/仓管 可执行（与付款单同口径） */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择供应商');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '供应商不存在');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '收款金额必须大于 0');
  END IF;

  /* 同一供应商的款项操作串行化（与付款/作废同一把锁） */
  PERFORM pg_advisory_xact_lock(hashtext(p_supplier_id::TEXT));

  /* 最新余额（全局口径：debit + refund − payment − credit − discount） */
  SELECT COALESCE(SUM(CASE transaction_type
      WHEN 'debit' THEN amount
      WHEN 'refund' THEN amount
      WHEN 'payment' THEN -amount
      WHEN 'credit' THEN -amount
      WHEN 'discount' THEN -amount
      ELSE 0 END), 0)::NUMERIC(12,2)
  INTO v_balance
  FROM supplier_transactions
  WHERE supplier_id = p_supplier_id;

  /* 收款语义：供应商把"咱多付的/退货款"退回来。只在负余额时有意义 */
  IF v_balance >= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '该供应商当前没有多付/待退余额，不能收款');
  END IF;
  IF p_amount > -v_balance THEN
    RETURN jsonb_build_object('success', false, 'error',
      '收款金额超过该供应商的待退余额 ' || TRIM(TO_CHAR(-v_balance, '999999990.00')) || ' 元');
  END IF;

  /* ── 建收款单（单号触发器生成） ── */
  INSERT INTO supplier_receipts (supplier_id, amount, payment_method, received_at, note, created_by)
  VALUES (
    p_supplier_id,
    p_amount,
    NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
    COALESCE(p_received_at, NOW()),
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    auth.uid()
  )
  RETURNING id, receipt_no INTO v_receipt_id, v_receipt_no;

  /* ── 写 refund 流水（+欠款，把负余额拉回；reference 指回收款单） ── */
  INSERT INTO supplier_transactions (
    supplier_id, transaction_type, amount, description,
    reference_id, reference_type, payment_method, created_by
  ) VALUES (
    p_supplier_id, 'refund', p_amount,
    '收款单 ' || v_receipt_no,
    v_receipt_id, 'supplier_receipt',
    NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
    auth.uid()
  );

  /* ── 补记财务流水（income/采购退款；触发器自动加账户余额）。
     科目 counts_in_profit=FALSE：与采购付款对称，属资金往来不是经营收入 ── */
  v_account_id := public.fn_finance_account_for_method(p_payment_method);
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION '未找到可用资金账户，请先在财务管理中建立账户';
  END IF;
  SELECT id INTO v_category_id FROM finance_categories
  WHERE type = 'income' AND name = '采购退款'
  ORDER BY created_at LIMIT 1;

  INSERT INTO finance_transactions (
    account_id, category_id, type, amount,
    related_type, related_id, description, transaction_date, created_by
  ) VALUES (
    v_account_id, v_category_id, 'income', p_amount,
    'supplier_receipt', v_receipt_id,
    '供应商退款（收款单 ' || v_receipt_no || '）',
    COALESCE(p_received_at, NOW())::DATE,
    auth.uid()
  );

  RETURN jsonb_build_object('success', true, 'receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func$ LANGUAGE plpgsql;

/* ─── 五、作废收款单：连同财务流水一起删 ─── */
CREATE OR REPLACE FUNCTION public.void_supplier_receipt(p_receipt_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作');
  END IF;

  SELECT * INTO v_receipt FROM supplier_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '收款单不存在');
  END IF;
  IF v_receipt.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', '该收款单已作废，请勿重复操作');
  END IF;

  /* 与该供应商的建单操作同一把锁，防作废与新建并发 */
  PERFORM pg_advisory_xact_lock(hashtext(v_receipt.supplier_id::TEXT));

  UPDATE supplier_receipts
  SET status = 'voided', voided_by = auth.uid(), voided_at = NOW()
  WHERE id = p_receipt_id;

  DELETE FROM supplier_transactions
  WHERE reference_type = 'supplier_receipt'
    AND reference_id = p_receipt_id
    AND transaction_type = 'refund';

  /* 财务流水同步删（触发器自动回扣账户余额） */
  DELETE FROM finance_transactions
  WHERE related_type = 'supplier_receipt'
    AND related_id = p_receipt_id;

  RETURN jsonb_build_object('success', true, 'receipt_no', v_receipt.receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 权限兜底重申（CREATE OR REPLACE 保留旧授权，此处对齐全库惯例） */
REVOKE EXECUTE ON FUNCTION public.create_supplier_payment(uuid, numeric, text, timestamptz, text, jsonb, numeric) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_supplier_payment(uuid, numeric, text, timestamptz, text, jsonb, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_supplier_payment(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_supplier_payment(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_supplier_receipt(uuid, numeric, text, timestamptz, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_supplier_receipt(uuid, numeric, text, timestamptz, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_supplier_receipt(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_supplier_receipt(uuid) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_r_supplier_payment_finance_log.sql') ON CONFLICT DO NOTHING;
