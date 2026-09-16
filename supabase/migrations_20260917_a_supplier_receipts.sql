/* 供应商收款单 + 汇总加累计优惠列（供应商款项改造 批次7，2026-09-17）
 *
 * 背景：
 *   对照 1 号车间供应商款项页改造：汇总大表要同时显示应付（正数）和应收
 *   （负数=咱多付/退货款待退）。负数余额挂着时，供应商把多付的钱退回来，
 *   需要一张"收款单"把账销平——此前全系统只有付款单，没有收款功能。
 *
 * 设计（定稿口径）：
 *   1. supplier_receipts 收款单：一次收款一张单（SK-日期-序号），结构与付款单对称
 *   2. 收款流水复用预留的 refund 类型（CHECK 与余额公式早已支持，从未使用）：
 *      供应商退咱钱 → +欠款 → 负余额拉回 0；对账单"退款"列自动显示，零改动
 *   3. 收款校验：仅当余额 < 0（供应商欠咱）时可收，且收款额 ≤ |余额|，
 *      防止把账收成正数（收款语义不是"帮供应商预付款"）
 *   4. 作废统一风格：单据打 voided 留痕 + 删 refund 流水（与作废付款单一致）
 *   5. supplier_balances 返回加 total_discount 累计列（汇总表要显示"累计优惠"）；
 *      返回结构变化必须 DROP 再 CREATE（三防）
 *
 * 幂等三防：建表建索引 IF NOT EXISTS；触发器/函数 CREATE OR REPLACE；
 *           改返回结构的函数 DROP 再 CREATE；策略 DROP 再 CREATE；
 *           台账 ON CONFLICT DO NOTHING。
*/

/* ============================================================
   一、收款单表（结构对照 supplier_payments）
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.supplier_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no TEXT UNIQUE,                    /* SK-YYYYMMDD-NNN，触发器生成 */
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT,                       /* 收款方式（现金/微信/支付宝/银行转账，复用 payment_methods 字典） */
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), /* 实际收款时间（补录可改） */
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'voided')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID REFERENCES public.profiles(id),
  voided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_supplier_receipts_supplier ON public.supplier_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_received_at ON public.supplier_receipts(received_at);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_status ON public.supplier_receipts(status);

/* ============================================================
   二、RLS：登录可读；写一律走 RPC（SECURITY DEFINER），不开客户端直写
   ============================================================ */
ALTER TABLE public.supplier_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_receipts_select ON public.supplier_receipts;
CREATE POLICY supplier_receipts_select ON public.supplier_receipts
  FOR SELECT TO authenticated USING (true);

/* ============================================================
   三、收款单号序列触发器：SK-YYYYMMDD-NNN（与付款单 FK- 同款模式）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.generate_supplier_receipt_no()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(suffix::INTEGER), 0) + 1 INTO seq_num
  FROM (
    SELECT REGEXP_REPLACE(receipt_no, '^SK-' || today || '-', '') AS suffix
    FROM supplier_receipts
    WHERE receipt_no LIKE 'SK-' || today || '-%'
  ) t
  WHERE suffix ~ '^\d+$';
  NEW.receipt_no := 'SK-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_supplier_receipt_no ON public.supplier_receipts;
CREATE TRIGGER set_supplier_receipt_no BEFORE INSERT ON public.supplier_receipts
  FOR EACH ROW WHEN (NEW.receipt_no IS NULL) EXECUTE FUNCTION public.generate_supplier_receipt_no();

/* ============================================================
   四、创建收款单（事务）
   参数:
     p_supplier_id     供应商 id（必填）
     p_amount          收款金额（>0，且 ≤ 当前待退余额）
     p_payment_method  收款方式（可空）
     p_received_at     实际收款时间（可空，默认当前）
     p_note            备注（可空）
   返回: { success, receipt_id, receipt_no, error? }
   ============================================================ */
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

  RETURN jsonb_build_object('success', true, 'receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_supplier_receipt(uuid, numeric, text, timestamptz, text) FROM anon, PUBLIC;

/* ============================================================
   五、作废收款单（事务）：打 voided 标 + 删 refund 流水
   ============================================================ */
CREATE OR REPLACE FUNCTION public.void_supplier_receipt(p_receipt_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $func$
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

  RETURN jsonb_build_object('success', true, 'receipt_no', v_receipt.receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.void_supplier_receipt(uuid) FROM anon, PUBLIC;

/* ============================================================
   六、supplier_balances 加累计优惠列（返回结构变化，DROP 再 CREATE）
   余额公式不变（debit + refund − payment − credit − discount），
   只多返回一列 total_discount 供汇总表"累计优惠"显示
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
  total_credit NUMERIC,
  total_discount NUMERIC
)
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
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
    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'credit'), 0)::NUMERIC(12,2) AS total_credit,
    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'discount'), 0)::NUMERIC(12,2) AS total_discount
  FROM suppliers s
  LEFT JOIN supplier_transactions t ON t.supplier_id = s.id
  GROUP BY s.id, s.name
  ORDER BY balance DESC;
END;
$func$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.supplier_balances() FROM anon, PUBLIC;

/* ============================================================
   七、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260917_a_supplier_receipts.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新表和策略:
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename = 'supplier_receipts';
      应返回 1 行（select 策略）。
   2. 单号触发器:
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.supplier_receipts'::regclass
        AND tgname = 'set_supplier_receipt_no';
      应返回 1 行。
   3. 两个新函数带门禁:
      SELECT proname FROM pg_proc
      WHERE proname IN ('create_supplier_receipt', 'void_supplier_receipt')
        AND pg_get_functiondef(oid) LIKE '%权限门禁%';
      应返回 2 行。
   4. supplier_balances 新列（应含 total_discount，共 8 列）:
      SELECT pg_get_function_result('public.supplier_balances()'::regprocedure);
   ============================================================
*/
