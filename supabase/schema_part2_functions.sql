CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS update_customers ON customers CASCADE;
CREATE TRIGGER update_customers BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_vehicles ON vehicles CASCADE;
CREATE TRIGGER update_vehicles BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_profiles ON profiles CASCADE;
CREATE TRIGGER update_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_work_orders ON work_orders CASCADE;
CREATE TRIGGER update_work_orders BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_parts ON parts CASCADE;
CREATE TRIGGER update_parts BEFORE UPDATE ON parts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_service_items ON service_items CASCADE;
CREATE TRIGGER update_service_items BEFORE UPDATE ON service_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_service_categories ON service_categories CASCADE;
CREATE TRIGGER update_service_categories BEFORE UPDATE ON service_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 创建维修项目时，自动从名称库填入项目名称
CREATE OR REPLACE FUNCTION auto_fill_service_item_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.service_name_id IS NOT NULL AND (NEW.name IS NULL OR NEW.name = '') THEN
    SELECT name INTO NEW.name FROM service_names WHERE id = NEW.service_name_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS fill_service_item_name ON service_items CASCADE;
CREATE TRIGGER fill_service_item_name BEFORE INSERT ON service_items
  FOR EACH ROW EXECUTE FUNCTION auto_fill_service_item_name();
CREATE OR REPLACE FUNCTION generate_order_no()
RETURNS TRIGGER AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(order_no, '^WO-' || today || '-', ''), '')), '0')::INTEGER + 1
  INTO seq_num
  FROM work_orders
  WHERE order_no LIKE 'WO-' || today || '-%';
  NEW.order_no := 'WO-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS set_work_order_no ON work_orders CASCADE;
CREATE TRIGGER set_work_order_no BEFORE INSERT ON work_orders
  FOR EACH ROW WHEN (NEW.order_no IS NULL)
  EXECUTE FUNCTION generate_order_no();
CREATE OR REPLACE FUNCTION log_work_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO work_order_history (work_order_id, from_status, to_status, changed_by, notes)
    VALUES (NEW.id, OLD.status, NEW.status, NULL, '系统自动记录');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS work_order_status_history ON work_orders CASCADE;
CREATE TRIGGER work_order_status_history BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION log_work_order_status_change();
CREATE OR REPLACE FUNCTION score_on_quality_fail()
RETURNS TRIGGER AS $$
DECLARE
  mechanic UUID;
BEGIN
  IF NEW.result = 'failed' THEN
    -- 找到主技师并扣分
    SELECT mechanic_id INTO mechanic
    FROM work_order_items
    WHERE work_order_id = NEW.work_order_id AND mechanic_id IS NOT NULL
    LIMIT 1;
    IF mechanic IS NOT NULL THEN
      INSERT INTO mechanic_scores (mechanic_id, work_order_id, score_type, points, notes)
      VALUES (mechanic, NEW.work_order_id, 'quality_fail', -5, '质检不合格返工');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS auto_score_quality_fail ON quality_checks CASCADE;
CREATE TRIGGER auto_score_quality_fail AFTER INSERT ON quality_checks
  FOR EACH ROW EXECUTE FUNCTION score_on_quality_fail();
CREATE OR REPLACE FUNCTION score_on_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    INSERT INTO mechanic_scores (mechanic_id, work_order_id, score_type, points, notes)
    SELECT mechanic_id, NEW.id, 'completion', 10, '工单完工'
    FROM work_order_items
    WHERE work_order_id = NEW.id AND mechanic_id IS NOT NULL
    GROUP BY mechanic_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS auto_score_completion ON work_orders CASCADE;
CREATE TRIGGER auto_score_completion AFTER UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION score_on_completion();
CREATE OR REPLACE FUNCTION update_customer_star_level()
RETURNS TRIGGER AS $$
BEGIN
  -- 更新累计消费
  UPDATE customers
  SET total_spent = COALESCE(total_spent, 0) + NEW.amount
  WHERE id = (SELECT customer_id FROM work_orders WHERE id = NEW.work_order_id);

  -- 自动计算星级（按累计消费金额）
  UPDATE customers
  SET star_level = CASE
    WHEN total_spent >= 50000 THEN 5
    WHEN total_spent >= 20000 THEN 4
    WHEN total_spent >= 10000 THEN 3
    WHEN total_spent >= 3000 THEN 2
    ELSE 1
  END
  WHERE id = (SELECT customer_id FROM work_orders WHERE id = NEW.work_order_id);

  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS auto_update_star ON payments CASCADE;
CREATE TRIGGER auto_update_star AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION update_customer_star_level();
DROP TRIGGER IF EXISTS update_part_categories ON part_categories CASCADE;
CREATE TRIGGER update_part_categories BEFORE UPDATE ON part_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 创建配件时，自动从名称库填入名称、单位、分类
CREATE OR REPLACE FUNCTION auto_fill_part_info()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.part_name_id IS NOT NULL THEN
    SELECT pn.name, pn.unit, pn.category_id
    INTO NEW.name, NEW.unit, NEW.category_id
    FROM part_names pn
    WHERE pn.id = NEW.part_name_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS fill_part_info ON parts CASCADE;
CREATE TRIGGER fill_part_info BEFORE INSERT ON parts
  FOR EACH ROW EXECUTE FUNCTION auto_fill_part_info();
CREATE OR REPLACE FUNCTION auto_link_part_to_vehicle()
RETURNS TRIGGER AS $$
DECLARE
  v_vehicle_model_id UUID;
  v_auto_link BOOLEAN;
BEGIN
  SELECT v.vehicle_model_id INTO v_vehicle_model_id
  FROM work_orders wo
  JOIN vehicles v ON v.id = wo.vehicle_id
  JOIN work_order_items woi ON woi.work_order_id = wo.id
  WHERE woi.id = NEW.work_order_item_id;

  SELECT pc.auto_link_vehicle_model INTO v_auto_link
  FROM parts p
  JOIN part_names pn ON pn.id = p.part_name_id
  JOIN part_categories pc ON pc.id = pn.category_id
  WHERE p.id = NEW.part_id;

  IF v_auto_link AND v_vehicle_model_id IS NOT NULL THEN
    INSERT INTO part_vehicle_models (part_id, vehicle_model_id)
    VALUES (NEW.part_id, v_vehicle_model_id)
    ON CONFLICT (part_id, vehicle_model_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS auto_link_vehicle_model ON work_order_item_parts CASCADE;
CREATE TRIGGER auto_link_vehicle_model AFTER INSERT ON work_order_item_parts
  FOR EACH ROW EXECUTE FUNCTION auto_link_part_to_vehicle();
CREATE OR REPLACE FUNCTION deduct_part_batch_fifo()
RETURNS TRIGGER AS $$
DECLARE
  v_remaining INTEGER := NEW.quantity;
  v_batch RECORD;
  v_before_qty INTEGER;
  v_work_order_id UUID;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'out' THEN
    -- 空分支不扣减库存
    IF NEW.part_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- 记录出库前总库存
    SELECT quantity INTO v_before_qty FROM parts WHERE id = NEW.part_id;
    SELECT work_order_id INTO v_work_order_id FROM work_order_items WHERE id = NEW.work_order_item_id;

    -- FIFO 扣减批次
    FOR v_batch IN
      SELECT id, remaining FROM part_batches
      WHERE part_id = NEW.part_id AND remaining > 0
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_batch.remaining >= v_remaining THEN
        UPDATE part_batches SET remaining = remaining - v_remaining WHERE id = v_batch.id;
        NEW.batch_id := v_batch.id;
        v_remaining := 0;
      ELSE
        UPDATE part_batches SET remaining = 0 WHERE id = v_batch.id;
        v_remaining := v_remaining - v_batch.remaining;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION '配件库存不足，缺少 % 个', v_remaining;
    END IF;

    -- 更新总库存
    UPDATE parts SET quantity = quantity - NEW.quantity WHERE id = NEW.part_id;

    -- 记录库存日志
    INSERT INTO inventory_logs (part_id, change_type, quantity, before_qty, after_qty, work_order_id, notes)
    VALUES (NEW.part_id, 'out', NEW.quantity, v_before_qty, v_before_qty - NEW.quantity, v_work_order_id, '工单领料出库');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS fifo_part_outbound ON work_order_item_parts CASCADE;
CREATE TRIGGER fifo_part_outbound BEFORE UPDATE ON work_order_item_parts
  FOR EACH ROW EXECUTE FUNCTION deduct_part_batch_fifo();
CREATE OR REPLACE FUNCTION return_part_to_batch()
RETURNS TRIGGER AS $$
DECLARE
  v_before_qty INTEGER;
  v_work_order_id UUID;
BEGIN
  IF OLD.status = 'out' AND NEW.status = 'returned' THEN
    -- 空分支不退回库存
    IF OLD.part_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT quantity INTO v_before_qty FROM parts WHERE id = OLD.part_id;
    SELECT work_order_id INTO v_work_order_id FROM work_order_items WHERE id = OLD.work_order_item_id;

    IF OLD.batch_id IS NOT NULL THEN
      UPDATE part_batches SET remaining = remaining + OLD.quantity WHERE id = OLD.batch_id;
    END IF;
    UPDATE parts SET quantity = quantity + OLD.quantity WHERE id = OLD.part_id;

    INSERT INTO inventory_logs (part_id, change_type, quantity, before_qty, after_qty, work_order_id, notes)
    VALUES (OLD.part_id, 'in', OLD.quantity, v_before_qty, v_before_qty + OLD.quantity, v_work_order_id, '工单退料入库');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';
DROP TRIGGER IF EXISTS part_return_to_batch ON work_order_item_parts CASCADE;
CREATE TRIGGER part_return_to_batch BEFORE UPDATE ON work_order_item_parts
  FOR EACH ROW EXECUTE FUNCTION return_part_to_batch();
CREATE OR REPLACE FUNCTION fn_deduct_batch_on_picking()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE part_batches
  SET quantity = quantity - NEW.quantity
  WHERE id = NEW.batch_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_deduct_batch_on_picking ON part_picking_records CASCADE;
CREATE TRIGGER trg_deduct_batch_on_picking
AFTER INSERT ON part_picking_records
FOR EACH ROW
EXECUTE FUNCTION fn_deduct_batch_on_picking();
CREATE OR REPLACE FUNCTION fn_restore_batch_on_return()
RETURNS TRIGGER AS $$
DECLARE
  v_batch_id UUID;
BEGIN
  IF NEW.picking_record_id IS NOT NULL THEN
    SELECT batch_id INTO v_batch_id FROM part_picking_records WHERE id = NEW.picking_record_id;
    IF v_batch_id IS NOT NULL THEN
      UPDATE part_batches
      SET quantity = quantity + NEW.quantity
      WHERE id = v_batch_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_restore_batch_on_return ON part_return_records CASCADE;
CREATE TRIGGER trg_restore_batch_on_return
AFTER INSERT ON part_return_records
FOR EACH ROW
EXECUTE FUNCTION fn_restore_batch_on_return();
CREATE OR REPLACE FUNCTION settle_work_order(
  p_order_id UUID,
  p_discount_amount DECIMAL(10,2),
  p_payments JSONB,
  p_account_id UUID,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
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

  -- 3. 预校验支付金额与会员余额
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

  -- 4. 应用整单折扣（仅当此前未应用过折扣时）
  IF p_discount_amount > 0 AND v_total_cost > 0 AND COALESCE(v_order.discount_amount, 0) = 0 THEN
    v_discount_rate := (v_total_cost - p_discount_amount) / v_total_cost;

    UPDATE work_order_items
    SET unit_price = ROUND(unit_price * v_discount_rate, 2)
    WHERE work_order_id = p_order_id;

    SELECT COALESCE(SUM(total_price), 0) INTO v_new_parts_cost
    FROM work_order_items WHERE work_order_id = p_order_id AND item_type = 'part';
    SELECT COALESCE(SUM(total_price), 0) INTO v_new_labor_cost
    FROM work_order_items WHERE work_order_id = p_order_id AND item_type = 'labor';
    SELECT COALESCE(SUM(total_price), 0) INTO v_new_other_cost
    FROM work_order_items WHERE work_order_id = p_order_id AND item_type = 'other';

    UPDATE work_orders
    SET parts_cost = v_new_parts_cost,
        labor_cost = v_new_labor_cost,
        other_cost = v_new_other_cost,
        discount_amount = p_discount_amount,
        discount_rate = v_discount_rate
    WHERE id = p_order_id;

    UPDATE work_order_item_mechanics
    SET commission_amount = ROUND(commission_amount * v_discount_rate, 2)
    WHERE work_order_item_id IN (
      SELECT id FROM work_order_items WHERE work_order_id = p_order_id
    );

    SELECT total_cost INTO v_total_cost FROM work_orders WHERE id = p_order_id;
  END IF;

  -- 5. 会员扣款（先扣款）
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

  -- 7. 更新工单状态
  UPDATE work_orders
  SET status = 'settled', settled_at = v_now
  WHERE id = p_order_id;

  -- 8. 财务流水
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

  -- 9. 应收账款
  v_remaining := v_total_cost - COALESCE(v_order.advance_payment, 0) - v_total_paying;

  IF v_credit_amount > 0 THEN
    INSERT INTO accounts_receivable (customer_id, work_order_id, amount, paid_amount, status, notes)
    VALUES (v_order.customer_id, p_order_id, v_credit_amount, 0, 'pending', '工单 ' || v_order.order_no || ' 挂账');
  END IF;

  IF v_remaining > 0 THEN
    INSERT INTO accounts_receivable (customer_id, work_order_id, amount, paid_amount, status, notes)
    VALUES (v_order.customer_id, p_order_id, v_remaining, 0, 'pending', '工单 ' || v_order.order_no || ' 未结清尾款');
  END IF;

  RETURN jsonb_build_object('success', true, 'total_cost', v_total_cost);
END;
$$;
CREATE OR REPLACE FUNCTION recharge_member(
  p_member_id UUID,
  p_amount DECIMAL(10,2),
  p_payment_method TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_member RECORD;
  v_new_balance DECIMAL(10,2);
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '充值金额必须大于 0');
  END IF;
  SELECT * INTO v_member FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '会员不存在');
  END IF;
  v_new_balance := COALESCE(v_member.balance, 0) + p_amount;
  UPDATE members SET balance = v_new_balance, updated_at = v_now WHERE id = p_member_id;
  INSERT INTO member_transactions (member_id, type, amount, balance_after, payment_method, notes, created_at)
  VALUES (p_member_id, 'recharge', p_amount, v_new_balance, p_payment_method, p_notes, v_now);
  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;
CREATE OR REPLACE FUNCTION transition_work_order(
  p_order_id UUID,
  p_next_status TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_order RECORD;
  v_valid_flow TEXT[];
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_order FROM work_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '工单不存在');
  END IF;
  IF v_order.status IN ('settled', 'delivered') THEN
    RETURN jsonb_build_object('success', false, 'error', '工单已结束，不能变更状态');
  END IF;
  v_valid_flow := CASE v_order.status
    WHEN 'received' THEN ARRAY['pending_diagnosis']
    WHEN 'pending_diagnosis' THEN ARRAY['pending_repair']
    WHEN 'pending_repair' THEN ARRAY['repairing']
    WHEN 'repairing' THEN ARRAY['pending_quality_check']
    WHEN 'pending_quality_check' THEN ARRAY['pending_close', 'repairing']
    WHEN 'pending_close' THEN ARRAY['pending_settlement']
    WHEN 'pending_settlement' THEN ARRAY['settled']
    WHEN 'settled' THEN ARRAY['delivered']
    ELSE ARRAY[]::TEXT[]
  END;
  IF NOT (p_next_status = ANY(v_valid_flow)) THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的状态流转: ' || v_order.status || ' -> ' || p_next_status);
  END IF;
  IF p_next_status = 'pending_quality_check' AND EXISTS (
    SELECT 1 FROM work_order_items WHERE work_order_id = p_order_id AND status != 'completed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '还有未完工的维修项目，不能提交质检');
  END IF;
  UPDATE work_orders
  SET status = p_next_status::work_order_status,
      started_at = CASE WHEN p_next_status = 'repairing' AND started_at IS NULL THEN v_now ELSE started_at END,
      completed_at = CASE WHEN p_next_status = 'pending_quality_check' AND completed_at IS NULL THEN v_now ELSE completed_at END,
      settled_at = CASE WHEN p_next_status = 'pending_settlement' AND settled_at IS NULL THEN v_now ELSE settled_at END,
      delivered_at = CASE WHEN p_next_status = 'delivered' AND delivered_at IS NULL THEN v_now ELSE delivered_at END
  WHERE id = p_order_id;
  INSERT INTO work_order_history (work_order_id, from_status, to_status, notes)
  VALUES (p_order_id, v_order.status, p_next_status, COALESCE(p_notes, '状态流转'));
  RETURN jsonb_build_object('success', true);
END;
$$;
CREATE OR REPLACE FUNCTION add_construction_log(
  p_work_order_item_id UUID,
  p_mechanic_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_status TEXT;
  v_work_order_id UUID;
  v_order_status TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_new_item_status TEXT;
BEGIN
  IF p_action NOT IN ('start', 'pause', 'resume', 'complete') THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的操作类型');
  END IF;
  SELECT status, work_order_id INTO v_item_status, v_work_order_id
  FROM work_order_items WHERE id = p_work_order_item_id FOR UPDATE;
  IF v_item_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '维修项目不存在');
  END IF;
  CASE p_action
    WHEN 'start' THEN
      IF v_item_status IN ('in_progress', 'completed') THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已开始或已完工，不能重复开始');
      END IF;
      v_new_item_status := 'in_progress';
    WHEN 'resume' THEN
      IF v_item_status = 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目正在施工中，无需恢复');
      END IF;
      IF v_item_status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已完工，不能恢复');
      END IF;
      v_new_item_status := 'in_progress';
    WHEN 'pause' THEN
      IF v_item_status != 'in_progress' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目未在施工中，不能中断');
      END IF;
      v_new_item_status := 'paused';
    WHEN 'complete' THEN
      IF v_item_status = 'completed' THEN
        RETURN jsonb_build_object('success', false, 'error', '项目已完工，不能重复完工');
      END IF;
      v_new_item_status := 'completed';
  END CASE;
  INSERT INTO work_order_item_construction_logs (
    work_order_item_id, mechanic_id, action, started_at, ended_at, duration_seconds, notes, created_at
  ) VALUES (
    p_work_order_item_id, p_mechanic_id, p_action,
    CASE WHEN p_action IN ('start', 'resume') THEN v_now ELSE NULL END,
    CASE WHEN p_action IN ('pause', 'complete') THEN v_now ELSE NULL END,
    NULL, NULL, v_now
  );
  UPDATE work_order_items SET status = v_new_item_status WHERE id = p_work_order_item_id;
  SELECT status INTO v_order_status FROM work_orders WHERE id = v_work_order_id;
  IF p_action IN ('start', 'resume') AND v_order_status = 'pending_repair' THEN
    UPDATE work_orders SET status = 'repairing', started_at = COALESCE(started_at, v_now)
    WHERE id = v_work_order_id;
  END IF;
  IF p_action = 'complete' AND NOT EXISTS (
    SELECT 1 FROM work_order_items WHERE work_order_id = v_work_order_id AND status != 'completed'
  ) THEN
    UPDATE work_orders SET status = 'pending_quality_check', completed_at = COALESCE(completed_at, v_now)
    WHERE id = v_work_order_id AND status IN ('repairing', 'pending_repair');
  END IF;
  RETURN jsonb_build_object('success', true, 'item_status', v_new_item_status);
END;
$$;
CREATE OR REPLACE FUNCTION create_work_order(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_company TEXT,
  p_plate_number TEXT,
  p_brand TEXT,
  p_model TEXT,
  p_vin TEXT,
  p_mileage_in INTEGER,
  p_fuel_level INTEGER,
  p_customer_complaint TEXT,
  p_inspection_notes TEXT,
  p_receptionist_id UUID,
  p_requirements JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id UUID;
  v_vehicle_id UUID;
  v_order_id UUID;
  v_req JSONB;
  v_seq INTEGER := 1;
BEGIN
  INSERT INTO customers (name, phone, company)
  VALUES (p_customer_name, p_customer_phone, NULLIF(p_customer_company, ''))
  RETURNING id INTO v_customer_id;
  INSERT INTO vehicles (customer_id, plate_number, brand, model, vin, mileage)
  VALUES (v_customer_id, p_plate_number, p_brand, p_model, NULLIF(p_vin, ''), COALESCE(p_mileage_in, 0))
  RETURNING id INTO v_vehicle_id;
  INSERT INTO work_orders (vehicle_id, customer_id, mileage_in, fuel_level, customer_complaint, inspection_notes, receptionist_id)
  VALUES (v_vehicle_id, v_customer_id, p_mileage_in, p_fuel_level, p_customer_complaint, NULLIF(p_inspection_notes, ''), p_receptionist_id)
  RETURNING id INTO v_order_id;
  FOR v_req IN SELECT * FROM jsonb_array_elements(p_requirements)
  LOOP
    IF NULLIF(trim(v_req->>'description'), '') IS NOT NULL THEN
      INSERT INTO work_order_requirements (work_order_id, seq, description, submitted_by, assigned_to, assignment_type)
      VALUES (v_order_id, v_seq, trim(v_req->>'description'), p_receptionist_id,
        NULLIF(v_req->>'assigned_to', '')::UUID,
        CASE WHEN NULLIF(v_req->>'assigned_to', '') IS NOT NULL THEN 'assigned' ELSE NULL END);
      v_seq := v_seq + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;