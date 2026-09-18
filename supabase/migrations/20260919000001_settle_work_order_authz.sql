/* ============================================================
 * settle_work_order 补登录+角色门禁（2026-09-19，9-15 诊断🟠#6 深挖）
 *
 * 背景：补结算拒绝路径测试时发现 settle_work_order 函数体内完全没有
 *   auth.uid()/角色校验——匿名可调用管钱函数。同场景的预收款函数
 *   （register_advance_payment，2026-08-27 起）已有 admin/boss/receptionist/accountant
 *   门禁且生产运转至今，本文件把结算对齐同一口径。
 *
 * 为什么放 CLI 平行目录（supabase/migrations/）：
 *   settle_work_order 的旧版定义在本目录 20260501000002，CI 建库重放顺序是
 *   先灌主序列 migrations_*.sql 再灌本目录——门禁版若放主序列会被旧版覆盖失效
 *   （2026-09-19 CI 实锤过一次）。本文件按 CLI 时间戳命名排在目录末尾，重放后生效。
 *
 * 函数体与 20260501000002 版完全一致，仅 BEGIN 开头插门禁块。
 * 幂等：CREATE OR REPLACE（参数列表未变，无需 DROP）；
 *   带 SET search_path = public（OR REPLACE 不带会丢 0902 迁移设的属性）。
 * ============================================================ */

CREATE OR REPLACE FUNCTION settle_work_order(
  p_order_id UUID,
  p_discount_amount DECIMAL(10,2),
  p_payments JSONB,
  p_account_id UUID,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $func$
DECLARE
  v_order RECORD;
  v_total_cost DECIMAL(10,2);
  v_discount_rate DECIMAL(10,8);
  v_payment JSONB;
  v_member RECORD;
  v_pay_amount DECIMAL(10,2);
  v_real_income DECIMAL(10,2) := 0;
  v_credit_amount DECIMAL(10,2) := 0;
  v_total_paying DECIMAL(10,2) := 0;
  v_remaining DECIMAL(10,2);
  v_income_category_id UUID;
  v_new_parts_cost DECIMAL(10,2);
  v_new_labor_cost DECIMAL(10,2);
  v_new_other_cost DECIMAL(10,2);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  /* 0. 登录校验 + 角色门禁（2026-09-19 补，对齐 register_advance_payment 口径：
     结算=收钱场景，仅管理员/老板/接待/会计可操作） */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'receptionist', 'accountant') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、接待、会计可结算');
  END IF;

  -- 1. 锁定工单（防止并发重复结算）
  SELECT * INTO v_order FROM work_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '工单不存在');
  END IF;
  IF v_order.status = 'settled' THEN
    RETURN jsonb_build_object('success', false, 'error', '工单已结算，不能重复结算');
  END IF;

  v_total_cost := COALESCE(v_order.parts_cost, 0) + COALESCE(v_order.labor_cost, 0) + COALESCE(v_order.other_cost, 0);

  -- 2. 校验折扣金额
  IF p_discount_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '折扣金额不能为负数');
  END IF;
  IF p_discount_amount > v_total_cost THEN
    RETURN jsonb_build_object('success', false, 'error', '折扣金额不能大于工单总额');
  END IF;

  -- 3. 预校验支付金额与会员余额（确保所有校验在修改前完成）
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_pay_amount := COALESCE((v_payment->>'amount')::DECIMAL, 0);
    IF v_pay_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', '支付金额不能为负数');
    END IF;
    v_total_paying := v_total_paying + v_pay_amount;

    IF (v_payment->>'method') = 'member' THEN
      IF (v_payment->>'member_id') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', '请选择会员');
      END IF;
      SELECT * INTO v_member FROM members WHERE id = (v_payment->>'member_id')::UUID;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', '会员不存在');
      END IF;
      IF v_member.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', '会员已失效');
      END IF;
      IF v_pay_amount > v_member.balance THEN
        RETURN jsonb_build_object('success', false, 'error', '会员余额不足');
      END IF;
    END IF;
  END LOOP;

  -- 校验：已预付/已付金额不能超过折扣后总额
  IF COALESCE(v_order.advance_payment, 0) > (v_total_cost - p_discount_amount) THEN
    RETURN jsonb_build_object('success', false, 'error', '预付款金额已超过折扣后总额');
  END IF;

  -- 校验：本次支付总额必须大于 0 且不超过待收金额（允许 1 分钱浮点误差）
  IF v_total_paying <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '支付金额必须大于 0');
  END IF;
  IF v_total_paying > (v_total_cost - p_discount_amount - COALESCE(v_order.advance_payment, 0) + 0.01) THEN
    RETURN jsonb_build_object('success', false, 'error', '支付金额不能超过待收金额');
  END IF;

  -- 4. 应用整单折扣（如有，且仅当此前未应用过折扣时）
  IF p_discount_amount > 0 AND v_total_cost > 0 AND COALESCE(v_order.discount_amount, 0) = 0 THEN
    v_discount_rate := (v_total_cost - p_discount_amount) / v_total_cost;

    -- 4a. 批量更新项目单价（利用 generated column total_price 自动重算）
    UPDATE work_order_items
    SET unit_price = ROUND(unit_price * v_discount_rate, 2)
    WHERE work_order_id = p_order_id;

    -- 4b. 从 generated column 重新汇总成本（确保精确）
    SELECT COALESCE(SUM(total_price), 0) INTO v_new_parts_cost
    FROM work_order_items WHERE work_order_id = p_order_id AND item_type = 'part';
    SELECT COALESCE(SUM(total_price), 0) INTO v_new_labor_cost
    FROM work_order_items WHERE work_order_id = p_order_id AND item_type = 'labor';
    SELECT COALESCE(SUM(total_price), 0) INTO v_new_other_cost
    FROM work_order_items WHERE work_order_id = p_order_id AND item_type = 'other';

    -- 4c. 更新工单成本与折扣信息
    UPDATE work_orders
    SET parts_cost = v_new_parts_cost,
        labor_cost = v_new_labor_cost,
        other_cost = v_new_other_cost,
        discount_amount = p_discount_amount,
        discount_rate = v_discount_rate
    WHERE id = p_order_id;

    -- 4d. 批量更新员工提成
    UPDATE work_order_item_mechanics
    SET commission_amount = ROUND(commission_amount * v_discount_rate, 2)
    WHERE work_order_item_id IN (
      SELECT id FROM work_order_items WHERE work_order_id = p_order_id
    );

    -- 重新读取折扣后的 total_cost
    SELECT total_cost INTO v_total_cost FROM work_orders WHERE id = p_order_id;
  END IF;

  -- 5. 会员扣款（先扣款，后保存支付记录——保证账实一致）
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    IF (v_payment->>'method') = 'member' THEN
      v_pay_amount := (v_payment->>'amount')::DECIMAL;

      UPDATE members
      SET balance = balance - v_pay_amount, updated_at = v_now
      WHERE id = (v_payment->>'member_id')::UUID AND balance >= v_pay_amount;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', '会员余额已被其他操作修改或不足，请刷新后重试');
      END IF;

      INSERT INTO member_transactions (member_id, type, amount, balance_after, work_order_id, notes)
      VALUES (
        (v_payment->>'member_id')::UUID,
        'consume',
        v_pay_amount,
        (SELECT balance FROM members WHERE id = (v_payment->>'member_id')::UUID),
        p_order_id,
        '工单消费 ' || v_order.order_no
      );
    END IF;
  END LOOP;

  -- 6. 保存支付记录
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_pay_amount := (v_payment->>'amount')::DECIMAL;
    INSERT INTO payments (work_order_id, method, amount, paid_at, notes)
    VALUES (p_order_id, v_payment->>'method', v_pay_amount, v_now, p_notes);

    IF (v_payment->>'method') != 'credit' AND (v_payment->>'method') != 'member' THEN
      v_real_income := v_real_income + v_pay_amount;
    END IF;
    IF (v_payment->>'method') = 'credit' THEN
      v_credit_amount := v_credit_amount + v_pay_amount;
    END IF;
  END LOOP;

  -- 7. 更新工单状态为已结算
  UPDATE work_orders
  SET status = 'settled', settled_at = v_now
  WHERE id = p_order_id;

  -- 8. 生成财务流水（实收部分）
  IF v_real_income > 0 THEN
    SELECT id INTO v_income_category_id
    FROM finance_categories
    WHERE type = 'income' AND name = '维修收入'
    LIMIT 1;

    INSERT INTO finance_transactions (
      account_id, category_id, type, amount,
      related_type, related_id, description, transaction_date
    ) VALUES (
      p_account_id, v_income_category_id, 'income', v_real_income,
      'work_order', p_order_id,
      '工单结算收入 ' || v_order.order_no,
      v_now::DATE
    );
  END IF;

  -- 9. 应收账款（挂账 + 尾款）
  v_remaining := v_total_cost - COALESCE(v_order.advance_payment, 0) - v_total_paying;

  IF v_credit_amount > 0 THEN
    INSERT INTO accounts_receivable (
      customer_id, work_order_id, amount, paid_amount, status, notes
    ) VALUES (
      v_order.customer_id, p_order_id, v_credit_amount, 0, 'pending',
      '工单 ' || v_order.order_no || ' 挂账'
    );
  END IF;

  IF v_remaining > 0 THEN
    INSERT INTO accounts_receivable (
      customer_id, work_order_id, amount, paid_amount, status, notes
    ) VALUES (
      v_order.customer_id, p_order_id, v_remaining, 0, 'pending',
      '工单 ' || v_order.order_no || ' 未结清尾款'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'total_cost', v_total_cost);
END;
$func$;
