/*
 * 第三轮 RLS 角色细分（2026-08-02，经用户逐项确认）
 * 用户决定：
 *   1. 价格表改价 → 管理员+老板+库房
 *   2. 新建/删除配件 → 管理员+老板+库房
 *   3. 维修工不操作外协 → 供应商往来账 → 管理员+老板+库房
 *   4. 工单删除 → 仅管理员；接待可开单/报废（UPDATE）但不能 DELETE
 *
 * 关键设计：4 个库存触发函数改 SECURITY DEFINER，
 * 维修工领料/退料由触发器代为改库存，本人不再需要直接写 parts/part_batches/inventory_logs
 */

/* ========== 〇、4 个库存触发函数改 SECURITY DEFINER（函数体原样保留） ========== */

CREATE OR REPLACE FUNCTION public.fn_deduct_batch_on_picking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_part_id UUID;
  v_remaining INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
BEGIN
  /* 锁定批次行,校验剩余量 */
  SELECT part_id, remaining INTO v_part_id, v_remaining
  FROM part_batches WHERE id = NEW.batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '库存批次不存在';
  END IF;
  IF v_remaining < NEW.quantity THEN
    RAISE EXCEPTION '批次剩余库存不足:剩余 % 件,本次要领 % 件', v_remaining, NEW.quantity;
  END IF;

  /* 扣批次剩余 */
  UPDATE part_batches SET remaining = remaining - NEW.quantity WHERE id = NEW.batch_id;

  /* 扣配件总库存,不足则报错整单回滚 */
  UPDATE parts SET quantity = quantity - NEW.quantity
  WHERE id = v_part_id AND quantity >= NEW.quantity
  RETURNING quantity INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION '配件总库存不足,无法出库';
  END IF;

  /* 查关联工单用于流水追溯 */
  SELECT woi.work_order_id INTO v_work_order_id
  FROM work_order_item_parts p
  JOIN work_order_items woi ON woi.id = p.work_order_item_id
  WHERE p.id = NEW.work_order_item_part_id;

  /* 写库存流水 */
  INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
  VALUES (v_part_id, 'outbound', -NEW.quantity, v_after + NEW.quantity, v_after, v_work_order_id, 'picking_record', NEW.id, '工单领料出库');

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_restore_batch_on_return()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch_id UUID;
  v_part_id UUID;
  v_picked INTEGER;
  v_returned INTEGER;
  v_after INTEGER;
  v_work_order_id UUID;
BEGIN
  /* 校验退料数量不超过该领料记录的净领量 */
  IF NEW.picking_record_id IS NOT NULL THEN
    SELECT batch_id, quantity INTO v_batch_id, v_picked
    FROM part_picking_records WHERE id = NEW.picking_record_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '领料记录不存在';
    END IF;
    SELECT COALESCE(SUM(quantity), 0) INTO v_returned
    FROM part_return_records
    WHERE picking_record_id = NEW.picking_record_id AND id <> NEW.id;
    IF v_returned + NEW.quantity > v_picked THEN
      RAISE EXCEPTION '退料数量超出可退数量:已领 % 件,已退 % 件,本次要退 % 件', v_picked, v_returned, NEW.quantity;
    END IF;
  END IF;

  /* 加回批次剩余和总库存 */
  IF v_batch_id IS NOT NULL THEN
    UPDATE part_batches SET remaining = remaining + NEW.quantity WHERE id = v_batch_id
    RETURNING part_id INTO v_part_id;
  END IF;
  IF v_part_id IS NULL THEN
    SELECT part_id INTO v_part_id FROM work_order_item_parts WHERE id = NEW.work_order_item_part_id;
  END IF;

  IF v_part_id IS NOT NULL THEN
    UPDATE parts SET quantity = quantity + NEW.quantity WHERE id = v_part_id
    RETURNING quantity INTO v_after;

    SELECT woi.work_order_id INTO v_work_order_id
    FROM work_order_item_parts p
    JOIN work_order_items woi ON woi.id = p.work_order_item_id
    WHERE p.id = NEW.work_order_item_part_id;

    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, work_order_id, reference_type, reference_id, notes)
    VALUES (v_part_id, 'return_in', NEW.quantity, v_after - NEW.quantity, v_after, v_work_order_id, 'return_record', NEW.id, '工单退料回库');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.deduct_part_batch_fifo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.return_part_to_batch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

/* ========== 一、价格表：admin、boss、warehouse 可写（读保持登录可读） ========== */

DROP POLICY IF EXISTS part_special_prices_auth ON part_special_prices;
CREATE POLICY part_special_prices_select ON part_special_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY part_special_prices_insert ON part_special_prices FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY part_special_prices_update ON part_special_prices FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY part_special_prices_delete ON part_special_prices FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

DROP POLICY IF EXISTS part_vehicle_prices_auth ON part_vehicle_prices;
CREATE POLICY part_vehicle_prices_select ON part_vehicle_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY part_vehicle_prices_insert ON part_vehicle_prices FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY part_vehicle_prices_update ON part_vehicle_prices FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY part_vehicle_prices_delete ON part_vehicle_prices FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

DROP POLICY IF EXISTS auth_full_access ON service_item_prices;
CREATE POLICY service_item_prices_select ON service_item_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY service_item_prices_insert ON service_item_prices FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY service_item_prices_update ON service_item_prices FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY service_item_prices_delete ON service_item_prices FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

DROP POLICY IF EXISTS auth_full_access ON service_item_special_prices;
CREATE POLICY service_item_special_prices_select ON service_item_special_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY service_item_special_prices_insert ON service_item_special_prices FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY service_item_special_prices_update ON service_item_special_prices FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY service_item_special_prices_delete ON service_item_special_prices FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

DROP POLICY IF EXISTS auth_full_access ON company_part_prices;
CREATE POLICY company_part_prices_select ON company_part_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY company_part_prices_insert ON company_part_prices FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY company_part_prices_update ON company_part_prices FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY company_part_prices_delete ON company_part_prices FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

DROP POLICY IF EXISTS auth_full_access ON company_service_prices;
CREATE POLICY company_service_prices_select ON company_service_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY company_service_prices_insert ON company_service_prices FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY company_service_prices_update ON company_service_prices FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY company_service_prices_delete ON company_service_prices FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

/* ========== 二、配件库存档案：admin、boss、warehouse 可写（维修工领料走 definer 触发器） ========== */

DROP POLICY IF EXISTS auth_full_access ON parts;
CREATE POLICY parts_select ON parts FOR SELECT TO authenticated USING (true);
CREATE POLICY parts_insert ON parts FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY parts_update ON parts FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY parts_delete ON parts FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

DROP POLICY IF EXISTS auth_full_access ON part_batches;
CREATE POLICY part_batches_select ON part_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY part_batches_insert ON part_batches FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY part_batches_update ON part_batches FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY part_batches_delete ON part_batches FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

/* ========== 三、库存流水：库房/管理可记，流水只有 admin、boss 能改删 ========== */

DROP POLICY IF EXISTS auth_full_access ON inventory_logs;
CREATE POLICY inventory_logs_select ON inventory_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_logs_insert ON inventory_logs FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY inventory_logs_update ON inventory_logs FOR UPDATE TO authenticated USING (public.has_role('admin','boss'));
CREATE POLICY inventory_logs_delete ON inventory_logs FOR DELETE TO authenticated USING (public.has_role('admin','boss'));

/* ========== 四、供应商往来账：admin、boss、warehouse 可写 ========== */

DROP POLICY IF EXISTS supplier_transactions_select ON supplier_transactions;
DROP POLICY IF EXISTS supplier_transactions_insert ON supplier_transactions;
DROP POLICY IF EXISTS supplier_transactions_update ON supplier_transactions;
DROP POLICY IF EXISTS supplier_transactions_delete ON supplier_transactions;
CREATE POLICY supplier_transactions_select ON supplier_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY supplier_transactions_insert ON supplier_transactions FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','warehouse'));
CREATE POLICY supplier_transactions_update ON supplier_transactions FOR UPDATE TO authenticated USING (public.has_role('admin','boss','warehouse'));
CREATE POLICY supplier_transactions_delete ON supplier_transactions FOR DELETE TO authenticated USING (public.has_role('admin','boss','warehouse'));

/* ========== 五、工单：接待可开单/改单（含转作废），删除仅管理员且只能删已作废单 ========== */

DROP POLICY IF EXISTS auth_full_access ON work_orders;
CREATE POLICY work_orders_select ON work_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY work_orders_insert ON work_orders FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss','receptionist'));
CREATE POLICY work_orders_update ON work_orders FOR UPDATE TO authenticated USING (public.has_role('admin','boss','receptionist'));
CREATE POLICY work_orders_delete ON work_orders FOR DELETE TO authenticated
USING (public.is_admin() AND order_type = 'cancelled');
