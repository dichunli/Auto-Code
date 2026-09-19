/* ============================================================
 * 结算混合收款按支付方式分账户记账（2026-09-19，严谨性整改阶段一 · 任务6）
 *
 * 问题（诊断实锤）：
 *   旧版把全部实收合并成【一条】finance_transactions 写到用户选的单一账户。
 *   现金+微信混合收 1000 元，微信那笔也进了现金账户——
 *   资金账户余额从此与实际（微信商户/现金抽屉）不符，无法按支付方式对账。
 *
 * 口径定义（修复后）：
 *   实收流水按支付方式【逐条】记账，账户解析顺序：
 *     1. fn_finance_account_for_method(支付方式) —— 同类型启用账户
 *        （cash→现金账户、wechat→微信商户、alipay→支付宝商户、bank_transfer→银行账户）
 *     2. p_account_id —— 用户在前端指定的收款账户，作为自定义方式/无匹配时的兜底
 *   credit（挂账）不记流水（未收钱）；member（储值卡）不记流水
 *   （充值时已入账，消费只是负债转营收）。
 *   每条条目 description 带支付方式名，方便对账。
 *
 * 为什么放 CLI 平行目录：与 20260919000001 同因——旧版定义在本目录
 *   20260501000002，CI 先灌主序列再灌本目录，本文件时间戳排在最后生效。
 *   依赖主序列 _q 迁移的 fn_finance_account_for_method（主序列先灌，顺序安全）。
 * 幂等：CREATE OR REPLACE（参数列表未变，无需 DROP）。
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
  v_method TEXT;
  v_method_name TEXT;
  v_tx_account UUID;
  v_credit_amount DECIMAL(10,2) := 0;
  v_total_paying DECIMAL(10,2) := 0;
  v_remaining DECIMAL(10,2);
  v_income_category_id UUID;
  v_new_parts_cost DECIMAL(10,2);
  v_new_labor_cost DECIMAL(10,2);
  v_new_other_cost DECIMAL(10,2);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  /* 0. 登录校验 + 角色门禁（对齐 register_advance_payment 口径：
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

  /* 维修收入科目（实收流水用），进循环前查好 */
  SELECT id INTO v_income_category_id
  FROM finance_categories
  WHERE type = 'income' AND name = '维修收入'
  LIMIT 1;

  -- 6. 保存支付记录 + 实收按支付方式逐条记财务流水
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_pay_amount := (v_payment->>'amount')::DECIMAL;
    v_method := v_payment->>'method';
    INSERT INTO payments (work_order_id, method, amount, paid_at, notes)
    VALUES (p_order_id, v_method, v_pay_amount, v_now, p_notes);

    IF v_method = 'credit' THEN
      /* 挂账：钱未收，不记流水，进应收账款 */
      v_credit_amount := v_credit_amount + v_pay_amount;
    ELSIF v_method != 'member' THEN
      /* 实收：逐条记账到该支付方式对应的资金账户（混合收款不再挤进单一账户）；
         解析失败兜底用户指定的 p_account_id */
      v_tx_account := public.fn_finance_account_for_method(v_method);
      IF v_tx_account IS NULL THEN
        v_tx_account := p_account_id;
      END IF;

      SELECT name INTO v_method_name FROM payment_methods WHERE code = v_method;

      INSERT INTO finance_transactions (
        account_id, category_id, type, amount,
        related_type, related_id, description, transaction_date
      ) VALUES (
        v_tx_account, v_income_category_id, 'income', v_pay_amount,
        'work_order', p_order_id,
        '工单结算收入 ' || v_order.order_no || '（' || COALESCE(v_method_name, v_method) || '）',
        v_now::DATE
      );
    END IF;
    /* member（储值卡）不记流水：充值时已入账，此处只是负债转营收 */
  END LOOP;

  -- 7. 更新工单状态为已结算
  UPDATE work_orders
  SET status = 'settled', settled_at = v_now
  WHERE id = p_order_id;

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
