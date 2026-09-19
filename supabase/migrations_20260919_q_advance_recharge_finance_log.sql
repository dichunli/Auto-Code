/* ============================================================
 * 预收款/预收退款/会员充值补记财务流水（2026-09-19，严谨性整改阶段一 · 任务4）
 *
 * 问题（诊断实锤）：
 *   预收款登记/退款、会员充值是三笔真金白银的现金流动，却只记业务表，
 *   不写 finance_transactions —— 资金账户余额永远小于实际现金，
 *   收支流水页看不到这些钱，账户余额不可信。
 *
 * 方案：
 *   1. 内部辅助函数 fn_finance_account_for_method：收款方式 → 资金账户。
 *      映射 cash/wechat/alipay/bank_transfer(含中文名兼容) → 同类型启用账户；
 *      兜底链：other 类型 → 任意启用账户；一个账户都没有 → 返回 NULL，调用方报错
 *      （宁可业务失败也不允许"钱收了没流水"）。
 *   2. 新增三个资金往来科目（counts_in_profit=FALSE，防利润双计）：
 *      预收款/会员充值（income，结算时工单总额才计营收）、预收退款（expense）。
 *   3. related_type CHECK 扩展：advance_payment / member_recharge /
 *      supplier_payment / supplier_receipt（后两个供下一步供应商付款补流水用）。
 *   4. 三个 RPC 补记流水（同一事务内，失败整体回滚）：
 *      register_advance_payment → income/预收款
 *      refund_advance_payment   → expense/预收退款
 *      recharge_member          → income/会员充值
 *      其中 recharge_member 由 INVOKER 改 SECURITY DEFINER（否则被财务表
 *      RLS 卡住），并补齐 auth.uid() + 角色门禁（admin/boss/receptionist/
 *      accountant，与 members/member_transactions 现有 RLS 口径完全一致，
 *      不扩大也不缩小可操作人群）。
 *
 * 历史存量：迁移前的预收款/充值没有流水，属阶段五存量清洗范围，本迁移不追溯。
 * 幂等：CREATE OR REPLACE + WHERE NOT EXISTS，重跑无害；recharge_member
 *   参数列表未变，无需 DROP。
 * ============================================================ */

/* ─── 一、收款方式 → 资金账户 解析（内部函数，禁止客户端直接调用） ─── */
CREATE OR REPLACE FUNCTION public.fn_finance_account_for_method(p_method TEXT)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_type TEXT;
  v_id UUID;
BEGIN
  /* 收款方式编码/中文名 → 账户类型 */
  v_type := CASE NULLIF(TRIM(COALESCE(p_method, '')), '')
    WHEN 'cash' THEN 'cash'
    WHEN '现金' THEN 'cash'
    WHEN 'wechat' THEN 'wechat'
    WHEN '微信' THEN 'wechat'
    WHEN 'alipay' THEN 'alipay'
    WHEN '支付宝' THEN 'alipay'
    WHEN 'bank_transfer' THEN 'bank'
    WHEN 'bank' THEN 'bank'
    WHEN '银行转账' THEN 'bank'
    WHEN '银行卡' THEN 'bank'
    ELSE NULL END;

  IF v_type IS NOT NULL THEN
    SELECT id INTO v_id FROM finance_accounts
    WHERE account_type = v_type AND is_active
    ORDER BY created_at LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  /* 兜底：other 类型账户 → 任意启用账户（自定义收款方式走这里） */
  SELECT id INTO v_id FROM finance_accounts
  WHERE account_type = 'other' AND is_active
  ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT id INTO v_id FROM finance_accounts
  WHERE is_active
  ORDER BY created_at LIMIT 1;
  RETURN v_id; /* 可能为 NULL：调用方必须报错，不允许静默丢流水 */
END;
$func$ LANGUAGE plpgsql STABLE;

REVOKE EXECUTE ON FUNCTION public.fn_finance_account_for_method(TEXT) FROM PUBLIC, anon, authenticated;

/* ─── 二、三个资金往来科目（不计入利润，防双计） ─── */
INSERT INTO finance_categories (name, type, sort_order, counts_in_profit)
SELECT '预收款', 'income', 10, FALSE
WHERE NOT EXISTS (SELECT 1 FROM finance_categories WHERE type = 'income' AND name = '预收款');

INSERT INTO finance_categories (name, type, sort_order, counts_in_profit)
SELECT '预收退款', 'expense', 10, FALSE
WHERE NOT EXISTS (SELECT 1 FROM finance_categories WHERE type = 'expense' AND name = '预收退款');

INSERT INTO finance_categories (name, type, sort_order, counts_in_profit)
SELECT '会员充值', 'income', 11, FALSE
WHERE NOT EXISTS (SELECT 1 FROM finance_categories WHERE type = 'income' AND name = '会员充值');

/* ─── 三、related_type 取值扩展 ─── */
ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_related_type_check;
ALTER TABLE finance_transactions ADD CONSTRAINT finance_transactions_related_type_check
  CHECK (related_type IN ('work_order','purchase_order','payroll','other',
                          'advance_payment','member_recharge',
                          'supplier_payment','supplier_receipt'));

/* ─── 四、预收款登记：补记 income/预收款 流水 ─── */
CREATE OR REPLACE FUNCTION register_advance_payment(
  p_work_order_id UUID,
  p_amount DECIMAL,
  p_method TEXT,
  p_collector_name TEXT DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_no TEXT;
  v_record_id UUID;
  v_account_id UUID;
  v_category_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'receptionist', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、接待、会计可登记预收款');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '请输入有效金额');
  END IF;
  IF NULLIF(TRIM(COALESCE(p_method, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择收款方式');
  END IF;

  SELECT order_no INTO v_order_no FROM work_orders WHERE id = p_work_order_id;
  IF v_order_no IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '工单不存在');
  END IF;

  /* 钱进了哪个账户必须明确，找不到账户宁可失败也不允许丢流水 */
  v_account_id := public.fn_finance_account_for_method(p_method);
  IF v_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未找到可用资金账户，请先在财务管理中建立账户');
  END IF;

  INSERT INTO advance_payment_records (work_order_id, amount, method, collector_id, collector_name, paid_at)
  VALUES (
    p_work_order_id, p_amount, p_method, auth.uid(),
    NULLIF(TRIM(COALESCE(p_collector_name, '')), ''), NOW()
  )
  RETURNING id INTO v_record_id;

  /* 工单预收额原子累加(服务端读最新值,不用客户端旧值) */
  UPDATE work_orders
  SET advance_payment = COALESCE(advance_payment, 0) + p_amount
  WHERE id = p_work_order_id;

  /* 补记财务流水（income/预收款；触发器自动加账户余额）。
     科目 counts_in_profit=FALSE：结算时工单总额才计营收，此处只是资金落账 */
  SELECT id INTO v_category_id FROM finance_categories
  WHERE type = 'income' AND name = '预收款'
  ORDER BY created_at LIMIT 1;

  INSERT INTO finance_transactions (
    account_id, category_id, type, amount,
    related_type, related_id, description, transaction_date, created_by
  ) VALUES (
    v_account_id, v_category_id, 'income', p_amount,
    'advance_payment', v_record_id,
    '工单预收款 ' || v_order_no,
    CURRENT_DATE,
    auth.uid()
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ─── 五、预收款退款：补记 expense/预收退款 流水 ─── */
CREATE OR REPLACE FUNCTION refund_advance_payment(
  p_record_id UUID,
  p_amount DECIMAL,
  p_refund_method TEXT
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_max_refund DECIMAL;
  v_order_no TEXT;
  v_account_id UUID;
  v_category_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'receptionist', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、接待、会计可退款');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '请输入有效退款金额');
  END IF;

  /* 锁行读最新已退额,防并发超退 */
  SELECT id, work_order_id, amount, refunded_amount INTO v_rec
  FROM advance_payment_records WHERE id = p_record_id FOR UPDATE;
  IF v_rec.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '预收款记录不存在');
  END IF;

  v_max_refund := v_rec.amount - COALESCE(v_rec.refunded_amount, 0);
  IF p_amount > v_max_refund THEN
    RETURN jsonb_build_object('success', false, 'error', '最多可退 ' || v_max_refund::TEXT);
  END IF;

  v_account_id := public.fn_finance_account_for_method(p_refund_method);
  IF v_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未找到可用资金账户，请先在财务管理中建立账户');
  END IF;

  UPDATE advance_payment_records
  SET refunded_amount = COALESCE(refunded_amount, 0) + p_amount,
      refunded_at = NOW(),
      refund_method = NULLIF(TRIM(COALESCE(p_refund_method, '')), '')
  WHERE id = p_record_id;

  UPDATE work_orders
  SET advance_payment = GREATEST(0, COALESCE(advance_payment, 0) - p_amount)
  WHERE id = v_rec.work_order_id;

  /* 补记财务流水（expense/预收退款；触发器自动扣账户余额） */
  SELECT order_no INTO v_order_no FROM work_orders WHERE id = v_rec.work_order_id;
  SELECT id INTO v_category_id FROM finance_categories
  WHERE type = 'expense' AND name = '预收退款'
  ORDER BY created_at LIMIT 1;

  INSERT INTO finance_transactions (
    account_id, category_id, type, amount,
    related_type, related_id, description, transaction_date, created_by
  ) VALUES (
    v_account_id, v_category_id, 'expense', p_amount,
    'advance_payment', v_rec.id,
    '预收款退款（工单 ' || COALESCE(v_order_no, '') || '）',
    CURRENT_DATE,
    auth.uid()
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ─── 六、会员充值：改 SECURITY DEFINER 并补记 income/会员充值 流水 ───
   角色门禁 admin/boss/receptionist/accountant 与 members/member_transactions
   现有 RLS 口径一致（2026-08-02 加固版），权限不扩不缩 */
CREATE OR REPLACE FUNCTION recharge_member(
  p_member_id UUID,
  p_amount DECIMAL(10,2),
  p_payment_method TEXT,
  p_notes TEXT
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member RECORD;
  v_new_balance DECIMAL(10,2);
  v_now TIMESTAMPTZ := NOW();
  v_tx_id UUID;
  v_account_id UUID;
  v_category_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'receptionist', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、接待、会计可充值');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '充值金额必须大于 0');
  END IF;

  v_account_id := public.fn_finance_account_for_method(p_payment_method);
  IF v_account_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未找到可用资金账户，请先在财务管理中建立账户');
  END IF;

  /* 锁定会员（原子更新余额） */
  SELECT * INTO v_member FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '会员不存在');
  END IF;

  /* 原子增加余额 */
  v_new_balance := COALESCE(v_member.balance, 0) + p_amount;

  UPDATE members
  SET balance = v_new_balance, updated_at = v_now
  WHERE id = p_member_id;

  /* 插入交易记录 */
  INSERT INTO member_transactions (member_id, type, amount, balance_after, payment_method, notes, created_at)
  VALUES (p_member_id, 'recharge', p_amount, v_new_balance, p_payment_method, p_notes, v_now)
  RETURNING id INTO v_tx_id;

  /* 补记财务流水（income/会员充值；触发器自动加账户余额）。
     科目 counts_in_profit=FALSE：储值是负债不是营收，结算扣卡时工单总额才计营收 */
  SELECT id INTO v_category_id FROM finance_categories
  WHERE type = 'income' AND name = '会员充值'
  ORDER BY created_at LIMIT 1;

  INSERT INTO finance_transactions (
    account_id, category_id, type, amount,
    related_type, related_id, description, transaction_date, created_by
  ) VALUES (
    v_account_id, v_category_id, 'income', p_amount,
    'member_recharge', v_tx_id,
    '会员充值（' || COALESCE(v_member.name, '') || '）',
    CURRENT_DATE,
    auth.uid()
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* 权限：三个业务函数收回匿名/PUBLIC，显式放行登录用户（角色在函数内门禁）。
   注意：这三个函数历史上从未显式 GRANT，一直靠 PUBLIC 默认授权，
   收回 PUBLIC 后必须补 GRANT authenticated，否则正常用户也被锁死 */
REVOKE EXECUTE ON FUNCTION public.register_advance_payment(UUID, DECIMAL, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_advance_payment(UUID, DECIMAL, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_advance_payment(UUID, DECIMAL, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_advance_payment(UUID, DECIMAL, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.recharge_member(UUID, DECIMAL, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recharge_member(UUID, DECIMAL, TEXT, TEXT) TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_q_advance_recharge_finance_log.sql') ON CONFLICT DO NOTHING;
