/* 供应商付款单 + 核销（供应商款项改造 批次1，2026-09-14）
 *
 * 背景：
 *   供应商付款一直是一笔孤立流水（supplier_transactions 里一条 payment），
 *   不与任何入库单勾稽——无法回答"哪张入库单还没付钱"，月底对账靠人工翻单。
 *
 * 设计（定稿口径）：
 *   1. supplier_payments 付款单：一次付款一张单（FK-日期-序号），带支付方式/付款时间
 *   2. supplier_payment_allocations 核销明细：付款单勾稽到具体应付流水（debit）
 *   3. 欠款余额仍按总账公式算（debit − payment − credit + refund），核销只是"标记"，
 *      不改余额——代收自动 payment、历史手工 payment 不勾单也不影响欠款数字
 *   4. 核销额度全局口径（不是按单限额）：
 *        付款来源池 = 有效付款单金额合计 + 游离 payment 流水合计（手工记的、物流代收的）
 *        可核销额度 = 付款来源池 − 已核销合计
 *        本单核销合计 ≤ 可核销额度 + 本单金额
 *      —— 多付的部分（预付余额）下次付款时自然参与勾单；代收代付也能勾
 *   5. supplier_transactions 加 payment_method 列：付款流水冗余记支付方式
 *
 * 幂等三防：建表建索引 IF NOT EXISTS；触发器/函数 CREATE OR REPLACE；
 *           策略 DROP 再 CREATE；台账 ON CONFLICT DO NOTHING。
*/

/* ============================================================
   一、付款单表
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no TEXT UNIQUE,                    /* FK-YYYYMMDD-NNN，触发器生成 */
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT,                       /* 支付方式（现金/微信/支付宝/银行转账，复用 payment_methods 字典） */
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),/* 实际付款时间（补录可改） */
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'voided')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),  /* FK 到 profiles：列表页可直接 select profiles(full_name) */
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID REFERENCES public.profiles(id),
  voided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_paid_at ON public.supplier_payments(paid_at);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_status ON public.supplier_payments(status);

/* ============================================================
   二、核销明细表（付款单 → 应付流水）
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.supplier_transactions(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spa_payment ON public.supplier_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_spa_transaction ON public.supplier_payment_allocations(transaction_id);

/* ============================================================
   三、往来账加支付方式列
   ============================================================ */
ALTER TABLE public.supplier_transactions ADD COLUMN IF NOT EXISTS payment_method TEXT;

/* ============================================================
   四、RLS：登录可读；写一律走 RPC（SECURITY DEFINER），不开客户端直写
   ============================================================ */
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;
CREATE POLICY supplier_payments_select ON public.supplier_payments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS spa_select ON public.supplier_payment_allocations;
CREATE POLICY spa_select ON public.supplier_payment_allocations
  FOR SELECT TO authenticated USING (true);

/* ============================================================
   五、付款单号序列触发器：FK-YYYYMMDD-NNN（与采购单 CG- 同款模式）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.generate_supplier_payment_no()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(suffix::INTEGER), 0) + 1 INTO seq_num
  FROM (
    SELECT REGEXP_REPLACE(payment_no, '^FK-' || today || '-', '') AS suffix
    FROM supplier_payments
    WHERE payment_no LIKE 'FK-' || today || '-%'
  ) t
  WHERE suffix ~ '^\d+$';
  NEW.payment_no := 'FK-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_supplier_payment_no ON public.supplier_payments;
CREATE TRIGGER set_supplier_payment_no BEFORE INSERT ON public.supplier_payments
  FOR EACH ROW WHEN (NEW.payment_no IS NULL) EXECUTE FUNCTION public.generate_supplier_payment_no();

/* ============================================================
   六、创建付款单（事务）
   参数:
     p_supplier_id     供应商 id（必填）
     p_amount          本次实际付款金额（>0）
     p_payment_method  支付方式（可空）
     p_paid_at         实际付款时间（可空，默认当前）
     p_note            备注（可空）
     p_allocations     核销明细 JSONB 数组：[{transaction_id, amount}, ...]
                       勾的都是该供应商的 debit 流水；可为空数组（纯预付）
   返回: { success, payment_id, payment_no, error? }
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_supplier_payment(
  p_supplier_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT NULL,
  p_paid_at TIMESTAMPTZ DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_allocations JSONB DEFAULT '[]'::JSONB
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
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '付款金额必须大于 0');
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

    /* 锁住目标应付流水，读最新已勾合计 */
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

  /* ── 全局核销额度校验：来源池 − 已核销 + 本单金额 ≥ 本单核销合计 ── */
  SELECT COALESCE(SUM(amount), 0) INTO v_pool
  FROM supplier_payments
  WHERE supplier_id = p_supplier_id AND status = 'confirmed';
  /* 游离 payment 流水（手工记的、物流代收的）也算付款来源 */
  SELECT v_pool + COALESCE(SUM(amount), 0) INTO v_pool
  FROM supplier_transactions
  WHERE supplier_id = p_supplier_id AND transaction_type = 'payment'
    AND (reference_type IS NULL OR reference_type <> 'supplier_payment');

  SELECT COALESCE(SUM(a.amount), 0) INTO v_allocated
  FROM supplier_payment_allocations a
  JOIN supplier_payments p ON p.id = a.payment_id
  WHERE p.supplier_id = p_supplier_id AND p.status = 'confirmed';

  IF v_alloc_total > v_pool - v_allocated + p_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      '核销合计 ' || TRIM(TO_CHAR(v_alloc_total, '999999990.00')) ||
      ' 元超过可核销额度（历史付款余额 ' || TRIM(TO_CHAR(v_pool - v_allocated, '999999990.00')) ||
      ' 元 + 本次付款 ' || TRIM(TO_CHAR(p_amount, '999999990.00')) || ' 元）');
  END IF;

  /* ── 建付款单（单号触发器生成） ── */
  INSERT INTO supplier_payments (supplier_id, amount, payment_method, paid_at, note, created_by)
  VALUES (
    p_supplier_id,
    p_amount,
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

  /* ── 写 payment 流水（总账口径不变；reference 指回付款单） ── */
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

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'payment_no', v_payment_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_supplier_payment(uuid, numeric, text, timestamptz, text, jsonb) FROM anon, PUBLIC;

/* ============================================================
   七、作废付款单（事务）：打 voided 标 + 删核销明细 + 删付款流水
   （与现有"撤销入库删 debit 流水"同一风格；付款单表保留 voided 记录留痕）
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

  /* 与该供应商的建单操作同一把锁，防作废与新建并发 */
  PERFORM pg_advisory_xact_lock(hashtext(v_payment.supplier_id::TEXT));

  UPDATE supplier_payments
  SET status = 'voided', voided_by = auth.uid(), voided_at = NOW()
  WHERE id = p_payment_id;

  DELETE FROM supplier_payment_allocations WHERE payment_id = p_payment_id;

  DELETE FROM supplier_transactions
  WHERE reference_type = 'supplier_payment'
    AND reference_id = p_payment_id
    AND transaction_type = 'payment';

  RETURN jsonb_build_object('success', true, 'payment_no', v_payment.payment_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.void_supplier_payment(uuid) FROM anon, PUBLIC;

/* ============================================================
   八、查供应商应付核销状态（只读）
   返回: {
     success,
     payables: [ { transaction_id, amount, allocated, remaining, created_at,
                   description, inbound_order_id, inbound_no, supplier_order_no } ],
     pool,            /* 付款来源池（有效付款单 + 游离 payment 流水） */
     allocated,       /* 已核销合计 */
     available,       /* 可核销额度 = pool − allocated */
     balance          /* 欠款余额 = debit − payment − credit + refund */
   }
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

  /* 应付清单：debit 流水 + 已勾合计 + 关联入库单号 */
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

  SELECT COALESCE(SUM(CASE transaction_type
      WHEN 'debit' THEN amount
      WHEN 'payment' THEN -amount
      WHEN 'credit' THEN -amount
      WHEN 'refund' THEN amount
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
   九、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260914_a_supplier_payments.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新表和策略:
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename IN ('supplier_payments', 'supplier_payment_allocations');
      应返回 2 行（各一条 select 策略）。
   2. 新列:
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'supplier_transactions' AND column_name = 'payment_method';
      应返回 1 行。
   3. 三个函数带门禁:
      SELECT proname FROM pg_proc
      WHERE proname IN ('create_supplier_payment', 'void_supplier_payment', 'list_supplier_payables')
        AND pg_get_functiondef(oid) LIKE '%权限门禁%';
      应返回 2 行（list 是只读不设角色门禁，不含在内）。
   4. 单号触发器:
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.supplier_payments'::regclass
        AND tgname = 'set_supplier_payment_no';
      应返回 1 行。
*/
