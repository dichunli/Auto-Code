/* 采购入库确认 / 退回待收货 —— 原子事务函数 */
/* 创建日期: 2026-08-11 */
/* 背景:
     原「确认入库」在浏览器里分 20+ 次请求写 8 张表(入库单/明细/库存/仓位/批次/流水/应付款/采购单状态/退货记录),
     中途失败留半成品错账;且仓位空值查询用空串、插入存 NULL,导致空仓位重复建行、库存虚增。
     「退回待收货」同样是 5 步无事务连环写。
   本迁移:
     一、complete_purchase_inbound —— 入库确认,一个事务完成全部写入,任一失败整体回滚
     二、revoke_pending_storage —— 退回待收货,一个事务完成回退
   两个函数均 SECURITY DEFINER(inbound_orders 表现行 RLS 仅 admin 可写),
   函数内校验调用者必须已登录,操作人由 Server Action 服务端验证后传入。
*/

/* ============================================================
   一、入库确认(原子事务)
   参数:
     p_purchase_order_id  采购单 id(必须处于 pending_storage)
     p_items              入库明细 JSONB 数组,每行:
                            purchase_order_item_id 采购明细 id(必填)
                            quantity     入库数量(以前端弹窗确认值为准)
                            batch_no     批次号(可空)
                            warehouse_id 仓库 id(可空)
                            location     仓位(可空,统一按空串口径存储)
                            notes        备注(可空)
                            is_excess    是否"多发退货"拆出行(true 则跳过入库)
     p_freight_amount     运费总额(服务端按数量占比分摊到每行 allocated_cost)
     p_operator_id        操作人 id(Server Action 验证登录后传入)
   返回: { success, inbound_order_id, inbound_no, error? }
   ============================================================ */
CREATE OR REPLACE FUNCTION complete_purchase_inbound(
  p_purchase_order_id UUID,
  p_items JSONB,
  p_freight_amount DECIMAL,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_poi RECORD;
  v_inbound_id UUID;
  v_inbound_no TEXT;
  v_qty INTEGER;
  v_total_qty INTEGER := 0;
  v_total_amount DECIMAL(12,2) := 0;
  v_per_unit_freight DECIMAL := 0;
  v_alloc DECIMAL(10,2);
  v_before_qty INTEGER;
  v_after_qty INTEGER;
  v_loc TEXT;
  v_ret RECORD;
  v_ret_qty INTEGER;
  v_supplier_name TEXT;
BEGIN
  /* 0. 必须已登录(SECURITY DEFINER 绕过 RLS,身份在此兜底) */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 1. 锁定采购单并校验状态(防并发重复入库) */
  SELECT * INTO v_order
  FROM purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许入库(可能已入库或被退回)');
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;

  /* 2. 先算总数量(不含多发退货行),用于运费分摊 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty > 0 THEN v_total_qty := v_total_qty + v_qty; END IF;
  END LOOP;
  IF v_total_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '入库数量必须大于 0');
  END IF;
  v_per_unit_freight := COALESCE(p_freight_amount, 0) / v_total_qty;

  /* 3. 创建入库单主表(单号由触发器生成) */
  INSERT INTO inbound_orders (
    purchase_order_id, supplier_id, supplier_name,
    total_quantity, total_amount, freight_amount,
    waybill_id, status, notes, operator_id
  ) VALUES (
    p_purchase_order_id, v_order.supplier_id, COALESCE(v_supplier_name, ''),
    0, 0, COALESCE(p_freight_amount, 0),
    v_order.waybill_id, 'completed', '', p_operator_id
  )
  RETURNING id, inbound_no INTO v_inbound_id, v_inbound_no;

  /* 4. 逐条入库:明细 + 加库存 + 仓位 + 批次 + 流水 */
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_item->>'is_excess')::BOOLEAN, false) THEN CONTINUE; END IF;
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    /* 以服务端采购明细为准取快照字段与单价,不信客户端 */
    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
      AND order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细 % 不属于本采购单', v_item->>'purchase_order_item_id';
    END IF;

    v_alloc := ROUND(v_per_unit_freight * v_qty, 2);
    v_total_amount := v_total_amount + v_qty * COALESCE(v_poi.unit_cost, 0) + v_alloc;

    INSERT INTO inbound_order_items (
      inbound_order_id, purchase_order_item_id, part_id,
      part_number, name, brand, specification, unit,
      quantity, unit_cost, allocated_cost,
      batch_no, warehouse_id, location, notes
    ) VALUES (
      v_inbound_id, v_poi.id, v_poi.part_id,
      v_poi.part_number, v_poi.name, v_poi.brand, v_poi.specification, v_poi.unit,
      v_qty, v_poi.unit_cost, v_alloc,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      NULLIF(v_item->>'warehouse_id', '')::UUID,
      NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''),
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    IF v_poi.part_id IS NULL THEN CONTINUE; END IF;

    /* 加库存:SQL 原子自增,并发安全;同时更新最近采购价 */
    UPDATE parts
    SET quantity = quantity + v_qty,
        purchase_price = COALESCE(v_poi.unit_cost, purchase_price)
    WHERE id = v_poi.part_id
    RETURNING quantity INTO v_after_qty;
    v_before_qty := v_after_qty - v_qty;

    /* 仓位库存:空仓位统一按空串口径匹配/存储,修复 NULL 与空串不一致导致的重复建行 */
    IF NULLIF(v_item->>'warehouse_id', '') IS NOT NULL THEN
      v_loc := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'location', '')), ''), '');
      UPDATE part_stock_locations
      SET quantity = quantity + v_qty
      WHERE part_id = v_poi.part_id
        AND warehouse_id = (v_item->>'warehouse_id')::UUID
        AND COALESCE(location, '') = v_loc;
      IF NOT FOUND THEN
        INSERT INTO part_stock_locations (part_id, warehouse_id, location, quantity)
        VALUES (v_poi.part_id, (v_item->>'warehouse_id')::UUID, v_loc, v_qty);
      END IF;
    END IF;

    /* 批次 */
    INSERT INTO part_batches (part_id, batch_no, quantity, remaining, unit_cost, supplier_id, inbound_type, reference_id, notes)
    VALUES (
      v_poi.part_id,
      NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), ''),
      v_qty, v_qty, v_poi.unit_cost, v_order.supplier_id,
      'purchase', p_purchase_order_id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );

    /* 库存流水(补记操作人) */
    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, waybill_id, operator_id, notes)
    VALUES (
      v_poi.part_id, 'inbound', v_qty, v_before_qty, v_after_qty,
      'inbound_order', v_inbound_id, v_order.waybill_id, p_operator_id,
      '采购入库: ' || COALESCE(v_poi.name, '') ||
        CASE WHEN NULLIF(TRIM(COALESCE(v_item->>'batch_no', '')), '') IS NOT NULL
             THEN ' 批次:' || TRIM(v_item->>'batch_no') ELSE '' END
    );
  END LOOP;

  /* 5. 回填入库单合计 */
  UPDATE inbound_orders
  SET total_quantity = v_total_qty, total_amount = v_total_amount
  WHERE id = v_inbound_id;

  /* 6. 破损/错发/弃货类:退库减库存(excess_return 多出部分未入库,无需扣减) */
  FOR v_ret IN
    SELECT * FROM purchase_order_items
    WHERE order_id = p_purchase_order_id
      AND handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard')
  LOOP
    v_ret_qty := v_ret.quantity;
    IF v_ret.part_id IS NOT NULL AND v_ret_qty > 0 THEN
      UPDATE parts SET quantity = GREATEST(0, quantity - v_ret_qty)
      WHERE id = v_ret.part_id;
    END IF;
  END LOOP;

  /* 7. 应付款 */
  IF v_order.supplier_id IS NOT NULL AND v_total_amount > 0 THEN
    INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
    VALUES (v_order.supplier_id, 'debit', ROUND(v_total_amount, 2), '采购入库', v_inbound_id, 'inbound_order');
  END IF;

  /* 8. 采购单状态 → 已完成 */
  UPDATE purchase_orders SET status = 'completed' WHERE id = p_purchase_order_id;

  /* 8.5 关联工单配件行标记已到货
     货已入库上架,配件流程状态机从「待收货」推进到「待入库/待领料」(partWorkflow 依赖 is_arrived) */
  UPDATE work_order_item_parts
  SET is_arrived = true
  WHERE id IN (
    SELECT work_order_item_part_id FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
  );

  /* 9. 自动生成待退货记录(破损/错发/多发退货) */
  INSERT INTO supplier_return_records (work_order_item_part_id, return_reason, quantity, supplier_name, photos, status)
  SELECT
    poi.work_order_item_part_id,
    CASE poi.handle_action
      WHEN 'broken_exchange' THEN 'damaged'
      WHEN 'broken_discard'  THEN 'damaged'
      WHEN 'wrong_exchange'  THEN 'wrong_ship'
      WHEN 'wrong_discard'   THEN 'wrong_ship'
      WHEN 'excess_return'   THEN 'excess'
    END,
    CASE WHEN poi.handle_action = 'excess_return'
         THEN GREATEST(0, COALESCE(poi.received_qty, 0) - poi.quantity)
         ELSE poi.quantity END,
    COALESCE(v_supplier_name, ''),
    /* evidence_photos 是 JSONB,photos 是 TEXT[],需逐元素转换 */
    (SELECT ARRAY(SELECT jsonb_array_elements_text(poi.evidence_photos))),
    'pending'
  FROM purchase_order_items poi
  WHERE poi.order_id = p_purchase_order_id
    AND poi.handle_action IN ('broken_exchange','broken_discard','wrong_exchange','wrong_discard','excess_return')
    AND poi.work_order_item_part_id IS NOT NULL
    AND CASE WHEN poi.handle_action = 'excess_return'
             THEN GREATEST(0, COALESCE(poi.received_qty, 0) - poi.quantity)
             ELSE poi.quantity END > 0;

  RETURN jsonb_build_object('success', true, 'inbound_order_id', v_inbound_id, 'inbound_no', v_inbound_no);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、退回待收货(原子事务)
   把 pending_storage 的采购单退回待收货:
   删除补货分支、删除待退货记录、清空处理结果、状态回 submitted、运单回退
   ============================================================ */
CREATE OR REPLACE FUNCTION revoke_pending_storage(
  p_purchase_order_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status <> 'pending_storage' THEN
    RETURN jsonb_build_object('success', false, 'error', '仅待入库状态可退回');
  END IF;

  /* 1. 删除该单配件行关联的补货分支(未采购未到货的 purchase_reason 克隆行) */
  DELETE FROM work_order_item_parts
  WHERE work_order_item_id IN (
    SELECT DISTINCT p.work_order_item_id
    FROM purchase_order_items poi
    JOIN work_order_item_parts p ON p.id = poi.work_order_item_part_id
    WHERE poi.order_id = p_purchase_order_id
      AND poi.work_order_item_part_id IS NOT NULL
  )
  AND purchase_reason IS NOT NULL
  AND is_purchased = false
  AND is_arrived = false;

  /* 2. 删除该单生成的待退货记录 */
  DELETE FROM supplier_return_records
  WHERE work_order_item_part_id IN (
    SELECT work_order_item_part_id FROM purchase_order_items
    WHERE order_id = p_purchase_order_id AND work_order_item_part_id IS NOT NULL
  )
  AND status = 'pending';

  /* 3. 清空明细处理结果 */
  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
  WHERE order_id = p_purchase_order_id;

  /* 4. 状态回已提交 */
  UPDATE purchase_orders SET status = 'submitted' WHERE id = p_purchase_order_id;

  /* 5. 运单回退:同运单下无其他待入库单才回退 */
  IF v_order.waybill_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM purchase_orders
       WHERE waybill_id = v_order.waybill_id
         AND status = 'pending_storage'
         AND id <> p_purchase_order_id
     ) THEN
    UPDATE logistics_waybills SET status = 'pending', received_at = NULL
    WHERE id = v_order.waybill_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
