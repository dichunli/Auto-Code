/* ============================================================
 * 会员充值补记财务流水 + DEFINER 化（2026-09-19，严谨性整改阶段一 · 任务4 补）
 *
 * 为什么放 CLI 平行目录（supabase/migrations/）：
 *   recharge_member 的原始定义在本目录 20260501000003_p0_security_fixes.sql，
 *   CI 建库先灌主序列 migrations_*.sql 再灌本目录——新定义若放主序列
 *   （migrations_20260919_q）会被旧版覆盖失效（与 settle_work_order
 *   2026-09-19 CI 实锤过的坑同款）。本文件时间戳排在目录末尾，重放后生效。
 *   依赖主序列 _q 迁移的 fn_finance_account_for_method 与 会员充值 科目
 *   （主序列先灌，顺序安全）。Dashboard 部署时 _q 和本文件都要执行。
 *
 * 改动内容：
 *   1. INVOKER → SECURITY DEFINER（否则写 finance_transactions 被财务表
 *      RLS 卡住——该表仅 admin/boss/accountant 可直写）
 *   2. 补 auth.uid() 登录校验 + 角色门禁（admin/boss/receptionist/accountant，
 *      与 members/member_transactions 现有 RLS 口径一致，权限不扩不缩）
 *   3. 同一事务补记 income/会员充值 流水（触发器自动加账户余额）。
 *      科目 counts_in_profit=FALSE：储值是负债不是营收，结算扣卡时才计营收
 *
 * 幂等：CREATE OR REPLACE（参数列表未变，无需 DROP）。
 * ============================================================ */

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

  /* 钱进了哪个账户必须明确，找不到账户宁可失败也不允许丢流水 */
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

/* 权限：收回匿名/PUBLIC，显式放行登录用户（角色在函数内门禁）。
   该函数历史上从未显式 GRANT，靠 PUBLIC 默认授权，收回后必须补 GRANT */
REVOKE EXECUTE ON FUNCTION public.recharge_member(UUID, DECIMAL, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recharge_member(UUID, DECIMAL, TEXT, TEXT) TO authenticated;
