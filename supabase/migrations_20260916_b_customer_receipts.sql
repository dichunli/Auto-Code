/* 客户挂账收款单 + 应收核销（往来账销账闭环 第一部分，2026-09-16）
 *
 * 背景：
 *   工单结算时挂账/尾款自动写 accounts_receivable（pending），但客户事后还钱
 *   没有登记入口——paid_amount 永远是 0，应收永远销不掉，账越积越假。
 *
 * 设计（仿供应商付款单全套，migrations_20260914_a_supplier_payments.sql）：
 *   1. customer_receipts 收款单：一次收款一张单（SK-日期-序号），
 *      带支付方式/收款账户/收款时间；账户必填（要写资金流水，钱进哪个账户必须明确）
 *   2. customer_receipt_allocations 核销明细：收款单勾稽到具体应收记录
 *   3. 口径：收多少销多少（核销合计 = 收款金额），不支持多收留存——
 *      客户欠款场景没有"预付"概念，要预存请走会员储值
 *   4. 核销即销账：更新 accounts_receivable.paid_amount/status（partial/paid）
 *   5. 写 finance_transactions（income/维修收入），触发器自动加资金账户余额；
 *      作废时删流水自动回退余额
 *   6. 权限：收钱是财务口径，仅 admin/boss/accountant（比供应商付款的 warehouse 更严）
 *
 * 顺手修安全遗留：
 *   5/1 迁移建的宽松策略 ar_full_access（登录即可全读写 accounts_receivable）
 *   一直没删，把 8/2 的角色收紧策略（admin/boss/accountant 才能写）架空了
 *   （RLS 策略是 OR 叠加）。本迁移 DROP 掉它，让收紧策略真正生效。
 *   已确认前端代码没有任何客户端直写 accounts_receivable 的地方，DROP 安全。
 *
 * 幂等三防：建表建索引 IF NOT EXISTS；触发器/函数 CREATE OR REPLACE；
 *           策略 DROP 再 CREATE；台账 ON CONFLICT DO NOTHING。
*/

/* ============================================================
   一、收款单表
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.customer_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no TEXT UNIQUE,                     /* SK-YYYYMMDD-NNN，触发器生成 */
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT,                        /* 支付方式（复用 payment_methods 字典，存 name） */
  account_id UUID NOT NULL REFERENCES public.finance_accounts(id), /* 钱进哪个资金账户（写流水用，必填） */
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), /* 实际收款时间（补录可改） */
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'voided')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID REFERENCES public.profiles(id),
  voided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_receipts_customer ON public.customer_receipts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_receipts_received_at ON public.customer_receipts(received_at);
CREATE INDEX IF NOT EXISTS idx_customer_receipts_status ON public.customer_receipts(status);

/* ============================================================
   二、核销明细表（收款单 → 应收记录）
   ============================================================ */
CREATE TABLE IF NOT EXISTS public.customer_receipt_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.customer_receipts(id) ON DELETE CASCADE,
  receivable_id UUID NOT NULL REFERENCES public.accounts_receivable(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cra_receipt ON public.customer_receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_cra_receivable ON public.customer_receipt_allocations(receivable_id);

/* ============================================================
   三、RLS：登录可读；写一律走 RPC（SECURITY DEFINER），不开客户端直写
   ============================================================ */
ALTER TABLE public.customer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_receipt_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_receipts_select ON public.customer_receipts;
CREATE POLICY customer_receipts_select ON public.customer_receipts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cra_select ON public.customer_receipt_allocations;
CREATE POLICY cra_select ON public.customer_receipt_allocations
  FOR SELECT TO authenticated USING (true);

/* 安全遗留修复：删掉 5/1 的宽松策略，让 8/2 的角色收紧（admin/boss/accountant 可写）生效 */
DROP POLICY IF EXISTS "ar_full_access" ON public.accounts_receivable;

/* ============================================================
   四、收款单号序列触发器：SK-YYYYMMDD-NNN（与付款单 FK- 同款模式）
   ============================================================ */
CREATE OR REPLACE FUNCTION public.generate_customer_receipt_no()
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
    SELECT REGEXP_REPLACE(receipt_no, '^SK-' || today || '-', '') AS suffix
    FROM customer_receipts
    WHERE receipt_no LIKE 'SK-' || today || '-%'
  ) t
  WHERE suffix ~ '^\d+$';
  NEW.receipt_no := 'SK-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_customer_receipt_no ON public.customer_receipts;
CREATE TRIGGER set_customer_receipt_no BEFORE INSERT ON public.customer_receipts
  FOR EACH ROW WHEN (NEW.receipt_no IS NULL) EXECUTE FUNCTION public.generate_customer_receipt_no();

/* ============================================================
   五、创建收款单（事务）
   参数:
     p_customer_id     客户 id（必填）
     p_amount          本次收款金额（>0）
     p_account_id      收款资金账户 id（必填，写 finance_transactions 用）
     p_payment_method  支付方式（可空）
     p_received_at     实际收款时间（可空，默认当前）
     p_note            备注（可空）
     p_allocations     核销明细 JSONB 数组：[{receivable_id, amount}, ...]
                       勾的都是该客户的应收记录；核销合计必须等于收款金额
   返回: { success, receipt_id, receipt_no, error? }
   ============================================================ */
CREATE OR REPLACE FUNCTION public.create_customer_receipt(
  p_customer_id UUID,
  p_amount NUMERIC,
  p_account_id UUID,
  p_payment_method TEXT DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_allocations JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id UUID;
  v_receipt_no TEXT;
  v_customer_name TEXT;
  v_alloc RECORD;
  v_ar RECORD;
  v_rids UUID[] := '{}';
  v_amts NUMERIC[] := '{}';
  v_alloc_total NUMERIC(12,2) := 0;
  v_category_id UUID;
  i INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:客户收款是财务口径，仅 管理员/老板/会计 可执行 */
  IF NOT public.has_role('admin', 'boss', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、会计可操作');
  END IF;

  IF p_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择客户');
  END IF;
  SELECT name INTO v_customer_name FROM customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '客户不存在');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '收款金额必须大于 0');
  END IF;
  IF p_account_id IS NULL OR NOT EXISTS (SELECT 1 FROM finance_accounts WHERE id = p_account_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择收款账户');
  END IF;

  /* 同一客户的收款串行化：防两个窗口同时收款导致超销 */
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::TEXT));

  /* ── 逐笔校验核销明细（同一条应收在本单内合并后校验） ── */
  FOR v_alloc IN
    SELECT (elem->>'receivable_id')::UUID AS rid, SUM((elem->>'amount')::NUMERIC) AS amt
    FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::JSONB)) elem
    GROUP BY 1
  LOOP
    IF v_alloc.amt IS NULL OR v_alloc.amt <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', '核销金额必须大于 0');
    END IF;

    /* 锁住目标应收记录，读最新已收 */
    SELECT ar.* INTO v_ar
    FROM accounts_receivable ar
    WHERE ar.id = v_alloc.rid
    FOR UPDATE OF ar;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '核销的应收记录不存在，请刷新后重试');
    END IF;
    IF v_ar.customer_id <> p_customer_id THEN
      RETURN jsonb_build_object('success', false, 'error', '核销记录不属于该客户');
    END IF;
    IF v_ar.status NOT IN ('pending', 'partial') THEN
      RETURN jsonb_build_object('success', false, 'error', '该笔应收已结清或已取消，请刷新后重试');
    END IF;
    IF v_alloc.amt > v_ar.amount - COALESCE(v_ar.paid_amount, 0) THEN
      RETURN jsonb_build_object('success', false, 'error',
        '核销金额超过该笔应收的未收余额（' || COALESCE(v_ar.notes, '') || '），请刷新后重试');
    END IF;

    v_rids := v_rids || v_alloc.rid;
    v_amts := v_amts || v_alloc.amt;
    v_alloc_total := v_alloc_total + v_alloc.amt;
  END LOOP;

  /* ── 口径校验：收多少销多少，核销合计必须等于收款金额 ── */
  IF v_alloc_total <> p_amount THEN
    RETURN jsonb_build_object('success', false, 'error',
      '核销合计 ' || TRIM(TO_CHAR(v_alloc_total, '999999990.00')) ||
      ' 元与收款金额 ' || TRIM(TO_CHAR(p_amount, '999999990.00')) ||
      ' 元不一致（收多少销多少，请调整勾稽）');
  END IF;

  /* ── 建收款单（单号触发器生成） ── */
  INSERT INTO customer_receipts (customer_id, amount, payment_method, account_id, received_at, note, created_by)
  VALUES (
    p_customer_id,
    p_amount,
    NULLIF(BTRIM(COALESCE(p_payment_method, '')), ''),
    p_account_id,
    COALESCE(p_received_at, NOW()),
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    auth.uid()
  )
  RETURNING id, receipt_no INTO v_receipt_id, v_receipt_no;

  /* ── 写核销明细 + 逐笔销账（paid_amount 累加，状态自动推进） ── */
  FOR i IN 1..COALESCE(array_length(v_rids, 1), 0) LOOP
    INSERT INTO customer_receipt_allocations (receipt_id, receivable_id, amount)
    VALUES (v_receipt_id, v_rids[i], v_amts[i]);

    UPDATE accounts_receivable
    SET paid_amount = COALESCE(paid_amount, 0) + v_amts[i],
        status = CASE
          WHEN COALESCE(paid_amount, 0) + v_amts[i] >= amount THEN 'paid'
          ELSE 'partial'
        END,
        updated_at = NOW()
    WHERE id = v_rids[i];
  END LOOP;

  /* ── 写财务流水（income/维修收入；触发器自动加账户余额） ── */
  SELECT id INTO v_category_id
  FROM finance_categories
  WHERE type = 'income' AND name = '维修收入'
  LIMIT 1;

  INSERT INTO finance_transactions (
    account_id, category_id, type, amount,
    related_type, related_id, description, transaction_date, created_by
  ) VALUES (
    p_account_id, v_category_id, 'income', p_amount,
    'other', v_receipt_id,
    '客户收款单 ' || v_receipt_no || '（' || COALESCE(v_customer_name, '') || ' 还欠款）',
    COALESCE(p_received_at, NOW())::DATE,
    auth.uid()
  );

  RETURN jsonb_build_object('success', true, 'receipt_id', v_receipt_id, 'receipt_no', v_receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_customer_receipt(uuid, numeric, uuid, text, timestamptz, text, jsonb) FROM anon, PUBLIC;

/* ============================================================
   六、作废收款单（事务）：回款单留痕 + 应收回滚 + 删核销明细 + 删财务流水
   ============================================================ */
CREATE OR REPLACE FUNCTION public.void_customer_receipt(p_receipt_id UUID)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_alloc RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、会计可操作');
  END IF;

  SELECT * INTO v_receipt FROM customer_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '收款单不存在');
  END IF;
  IF v_receipt.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', '该收款单已作废，请勿重复操作');
  END IF;

  /* 与该客户的建单操作同一把锁，防作废与新建并发 */
  PERFORM pg_advisory_xact_lock(hashtext(v_receipt.customer_id::TEXT));

  /* 逐笔回滚应收（先按核销明细回退，再删明细） */
  FOR v_alloc IN
    SELECT receivable_id, amount FROM customer_receipt_allocations WHERE receipt_id = p_receipt_id
  LOOP
    UPDATE accounts_receivable
    SET paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_alloc.amount),
        status = CASE
          WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_alloc.amount) <= 0 THEN 'pending'
          WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_alloc.amount) >= amount THEN 'paid'
          ELSE 'partial'
        END,
        updated_at = NOW()
    WHERE id = v_alloc.receivable_id;
  END LOOP;

  DELETE FROM customer_receipt_allocations WHERE receipt_id = p_receipt_id;

  /* 删财务流水（触发器自动回退账户余额）；related_id 是本收款单 id，精确匹配不误删 */
  DELETE FROM finance_transactions
  WHERE related_type = 'other' AND related_id = p_receipt_id;

  UPDATE customer_receipts
  SET status = 'voided', voided_by = auth.uid(), voided_at = NOW()
  WHERE id = p_receipt_id;

  RETURN jsonb_build_object('success', true, 'receipt_no', v_receipt.receipt_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.void_customer_receipt(uuid) FROM anon, PUBLIC;

/* ============================================================
   七、查客户待收款应收清单（只读；前端勾稽弹窗用）
   返回: {
     success,
     receivables: [ { transaction_id(=应收id，对齐勾稽组件口径), work_order_id, order_no,
                     amount, paid_amount, remaining, created_at, due_date, notes } ],
     total_remaining   —— 该客户待收合计
   }
   ============================================================ */
CREATE OR REPLACE FUNCTION public.list_customer_receivables(p_customer_id UUID)
RETURNS JSONB
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receivables JSONB;
  v_total NUMERIC(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY ar_created_at ASC), '[]'::JSONB)
  INTO v_receivables
  FROM (
    SELECT jsonb_build_object(
      'transaction_id', ar.id,
      'work_order_id', ar.work_order_id,
      'order_no', wo.order_no,
      'amount', ar.amount,
      'paid_amount', COALESCE(ar.paid_amount, 0),
      'remaining', ar.amount - COALESCE(ar.paid_amount, 0),
      'created_at', ar.created_at,
      'due_date', ar.due_date,
      'notes', ar.notes
    ) AS row_data,
    ar.created_at AS ar_created_at
    FROM accounts_receivable ar
    LEFT JOIN work_orders wo ON wo.id = ar.work_order_id
    WHERE ar.customer_id = p_customer_id
      AND ar.status IN ('pending', 'partial')
  ) t;

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0) INTO v_total
  FROM accounts_receivable
  WHERE customer_id = p_customer_id AND status IN ('pending', 'partial');

  RETURN jsonb_build_object(
    'success', true,
    'receivables', v_receivables,
    'total_remaining', v_total
  );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.list_customer_receivables(uuid) FROM anon, PUBLIC;

/* ============================================================
   八、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260916_b_customer_receipts.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 新表和策略:
      SELECT tablename, policyname FROM pg_policies
      WHERE tablename IN ('customer_receipts', 'customer_receipt_allocations');
      应返回 2 行（各一条 select 策略）。
   2. 宽松策略已删:
      SELECT policyname FROM pg_policies
      WHERE tablename = 'accounts_receivable' AND policyname = 'ar_full_access';
      应返回 0 行。
   3. 三个函数存在:
      SELECT proname FROM pg_proc
      WHERE proname IN ('create_customer_receipt', 'void_customer_receipt', 'list_customer_receivables');
      应返回 3 行。
   4. 单号触发器:
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.customer_receipts'::regclass
        AND tgname = 'set_customer_receipt_no';
      应返回 1 行。
*/
