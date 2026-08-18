/* 采购 RPC 角色门禁固化 + 暂存清理收编（2026-08-19 批次4）
 *
 * 背景：
 *   1. 20260814 的角色门禁是用"读出函数定义→锚点字符串替换→EXECUTE 回写"注入的，
 *      今后任何人 CREATE OR REPLACE 重写这些函数体都会静默丢门禁，无机制防止。
 *      本迁移把 9 个函数以"含门禁的完整定义"入库——此后函数体即权威定义，
 *      改函数必须基于含门禁版本（版本库里的 0811 原文不再是最新，以本文件为准）。
 *   2. 发起采购成功后删除暂存行此前是客户端补删（失败仅 console.warn，
 *      残留会导致暂存件重复显示在待采购→重复采购）。收编进 create_purchase_orders
 *      事务内删除（新参数 p_staging_ids，与建单同一事务成败）。
 *
 * 函数体与 20260811 原版逐字一致，唯一差异：登录检查后内置角色门禁段
 * （revoke_supplier_returns 已于 20260816 固化，不在本文件）。
 *
 * 注意：create_purchase_orders 改了签名（加 p_staging_ids），属于新函数重载——
 * 本文件先 DROP 旧签名函数，再建新版，防止新旧并存误调。
*/

/* ============================================================
   〇、create_purchase_orders 旧签名下线（两参版，已无调用方）
   ============================================================ */
DROP FUNCTION IF EXISTS public.create_purchase_orders(jsonb, uuid);

/* ============================================================
   一、创建采购单（含暂存清理）
   ============================================================ */
CREATE OR REPLACE FUNCTION create_purchase_orders(
  p_orders JSONB,
  p_staging_ids UUID[],
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group JSONB;
  v_item JSONB;
  v_order_id UUID;
  v_order_no TEXT;
  v_total DECIMAL(12,2);
  v_supplier_name TEXT;
  v_result JSONB := '[]'::JSONB;
  v_branch_ids UUID[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_orders IS NULL OR jsonb_array_length(p_orders) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不能为空');
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    /* 校验供应商并取名(回写工单配件行用) */
    SELECT name INTO v_supplier_name FROM suppliers
    WHERE id = (v_group->>'supplier_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION '供应商不存在';
    END IF;
    IF v_group->'items' IS NULL OR jsonb_array_length(v_group->'items') = 0 THEN
      RAISE EXCEPTION '采购单明细不能为空';
    END IF;

    /* 服务端算总金额,不用客户端传的数 */
    SELECT COALESCE(SUM(
      COALESCE((it->>'quantity')::INTEGER, 0) * COALESCE((it->>'unit_cost')::DECIMAL, 0)
    ), 0) INTO v_total
    FROM jsonb_array_elements(v_group->'items') it;

    /* 建单头(order_no 由触发器生成) */
    INSERT INTO purchase_orders (supplier_id, status, total_amount, logistics_company_id, notes, created_by)
    VALUES (
      (v_group->>'supplier_id')::UUID,
      COALESCE(NULLIF(v_group->>'status', ''), 'submitted'),
      v_total,
      NULLIF(v_group->>'logistics_company_id', '')::UUID,
      v_group->>'notes',
      p_operator_id
    )
    RETURNING id, order_no INTO v_order_id, v_order_no;

    /* 插明细 */
    v_branch_ids := '{}';
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_group->'items')
    LOOP
      INSERT INTO purchase_order_items (
        order_id, part_id, part_name_id, part_number, name, supplier_part_name,
        brand, specification, quantity, unit, unit_cost, category, license_plate,
        photos, notes, work_order_item_part_id, received_qty
      ) VALUES (
        v_order_id,
        NULLIF(v_item->>'part_id', '')::UUID,
        NULLIF(v_item->>'part_name_id', '')::UUID,
        v_item->>'part_number',
        v_item->>'name',
        v_item->>'supplier_part_name',
        v_item->>'brand',
        v_item->>'specification',
        GREATEST(1, COALESCE((v_item->>'quantity')::INTEGER, 1)),
        v_item->>'unit',
        COALESCE((v_item->>'unit_cost')::DECIMAL, 0),
        v_item->>'category',
        v_item->>'license_plate',
        COALESCE(v_item->'photos', '[]'::JSONB),
        v_item->>'notes',
        NULLIF(v_item->>'work_order_item_part_id', '')::UUID,
        0
      );
      IF NULLIF(v_item->>'work_order_item_part_id', '') IS NOT NULL THEN
        v_branch_ids := array_append(v_branch_ids, (v_item->>'work_order_item_part_id')::UUID);
      END IF;
    END LOOP;

    /* 回写工单配件行:已采购 + 供应商名称(与单头同事务) */
    IF array_length(v_branch_ids, 1) > 0 THEN
      UPDATE work_order_item_parts
      SET is_purchased = true, supplier_name = v_supplier_name
      WHERE id = ANY(v_branch_ids);
    END IF;

    v_result := v_result || jsonb_build_object('id', v_order_id, 'order_no', v_order_no);
  END LOOP;

  /* 清理已进采购单的暂存行（2026-08-19 收编：与建单同一事务，失败整体回滚） */
  IF p_staging_ids IS NOT NULL AND array_length(p_staging_ids, 1) > 0 THEN
    DELETE FROM custom_purchase_staging WHERE id = ANY(p_staging_ids);
  END IF;

  RETURN jsonb_build_object('success', true, 'orders', v_result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、确认入库（函数体与 0811 版一致 + 内置门禁）
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
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
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
   三、退回待收货（函数体与 0811 版一致 + 内置门禁）
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
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
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

/* ============================================================
   四、收货处理（函数体与 0811 版一致 + 内置门禁）
   ============================================================ */
CREATE OR REPLACE FUNCTION receive_purchase_item(
  p_order_id UUID,
  p_item_id UUID,
  p_handle_action TEXT,
  p_received_qty INTEGER,
  p_evidence_photos JSONB,
  p_set_evidence BOOLEAN,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_reason TEXT;
  v_branch_qty INTEGER;
  v_all_handled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_handle_action NOT IN (
    'normal','broken_exchange','broken_discard','wrong_exchange','wrong_discard',
    'excess_return','excess_paid','excess_free','short_repurchase','short_discard'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', '非法的处理动作');
  END IF;
  IF p_received_qty IS NULL OR p_received_qty < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '实收数量必须 ≥ 0');
  END IF;

  /* 锁单,防并发收货状态算错 */
  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status NOT IN ('submitted', 'approved', 'partial_received') THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许收货');
  END IF;

  /* 1. 更新明细处理结果 */
  UPDATE purchase_order_items
  SET handle_action = p_handle_action,
      received_qty = p_received_qty,
      evidence_photos = CASE WHEN p_set_evidence
                             THEN COALESCE(p_evidence_photos, '[]'::JSONB)
                             ELSE evidence_photos END
  WHERE id = p_item_id AND order_id = p_order_id
  RETURNING * INTO v_item;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 2. 需要补货的动作 → 克隆工单配件行 */
  v_reason := CASE p_handle_action
    WHEN 'broken_exchange'   THEN 'broken_resupply'
    WHEN 'wrong_exchange'    THEN 'wrong_exchange'
    WHEN 'short_repurchase'  THEN 'short_resupply'
    ELSE NULL END;

  IF v_reason IS NOT NULL AND v_item.work_order_item_part_id IS NOT NULL THEN
    /* 少发补货数量 = 订购数 - 实收数;其他场景沿用原数量 */
    IF p_handle_action = 'short_repurchase' THEN
      v_branch_qty := v_item.quantity - p_received_qty;
    ELSE
      SELECT quantity INTO v_branch_qty FROM work_order_item_parts
      WHERE id = v_item.work_order_item_part_id;
    END IF;

    IF COALESCE(v_branch_qty, 0) > 0 THEN
      INSERT INTO work_order_item_parts (
        work_order_item_id, part_name_id, branch_group_id, is_selected,
        part_id, part_number, name, alias_name, unit, brand, specification,
        unit_cost, unit_price, quantity, customer_opinion,
        is_purchased, is_arrived, supplier_name, logistics_agreement, notes,
        purchase_reason
      )
      SELECT
        work_order_item_id, part_name_id, branch_group_id, false,
        part_id, part_number, name, alias_name, unit, brand, specification,
        unit_cost, unit_price, v_branch_qty, 'agree',
        false, false, supplier_name, logistics_agreement, notes,
        v_reason
      FROM work_order_item_parts
      WHERE id = v_item.work_order_item_part_id;
    END IF;
  END IF;

  /* 3. 服务端重算采购单状态(不再由客户端重读重算) */
  SELECT bool_and(handle_action IS NOT NULL) INTO v_all_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_all_handled THEN
    UPDATE purchase_orders SET status = 'pending_storage' WHERE id = p_order_id;
    /* 运单标记已签收 */
    IF v_order.waybill_id IS NOT NULL THEN
      UPDATE logistics_waybills SET status = 'received', received_at = NOW()
      WHERE id = v_order.waybill_id;
    END IF;
  ELSE
    UPDATE purchase_orders SET status = 'partial_received' WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'all_handled', v_all_handled);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   五、撤销收货（函数体与 0811 版一致 + 内置门禁）
   ============================================================ */
CREATE OR REPLACE FUNCTION revoke_purchase_receipt(
  p_order_id UUID,
  p_item_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_reason TEXT;
  v_any_handled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;

  /* 1. 读出旧处理动作(删补货分支要用),再清空 */
  SELECT * INTO v_item FROM purchase_order_items
  WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  UPDATE purchase_order_items
  SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
  WHERE id = p_item_id;

  /* 2. 删除该动作生成的补货分支(未采购未到货的) */
  v_reason := CASE v_item.handle_action
    WHEN 'broken_exchange'   THEN 'broken_resupply'
    WHEN 'wrong_exchange'    THEN 'wrong_exchange'
    WHEN 'short_repurchase'  THEN 'short_resupply'
    ELSE NULL END;

  IF v_reason IS NOT NULL AND v_item.work_order_item_part_id IS NOT NULL THEN
    DELETE FROM work_order_item_parts
    WHERE work_order_item_id = (
            SELECT work_order_item_id FROM work_order_item_parts
            WHERE id = v_item.work_order_item_part_id
          )
      AND purchase_reason = v_reason
      AND is_purchased = false
      AND is_arrived = false;
  END IF;

  /* 3. 服务端重算状态 */
  SELECT bool_or(handle_action IS NOT NULL) INTO v_any_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  UPDATE purchase_orders
  SET status = CASE WHEN v_any_handled THEN 'partial_received' ELSE 'submitted' END
  WHERE id = p_order_id;

  /* 4. 若原先是待入库状态被回退,且同运单无其他待入库单,运单回退 */
  IF v_order.status = 'pending_storage' AND v_order.waybill_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM purchase_orders
       WHERE waybill_id = v_order.waybill_id AND status = 'pending_storage' AND id <> p_order_id
     ) THEN
    UPDATE logistics_waybills SET status = 'pending', received_at = NULL
    WHERE id = v_order.waybill_id;
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   六、少发弃货删明细（函数体与 0811 版一致 + 内置门禁）
   ============================================================ */
CREATE OR REPLACE FUNCTION delete_purchase_item(
  p_order_id UUID,
  p_item_id UUID,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_remaining INTEGER;
  v_any_handled BOOLEAN;
  v_any_unhandled BOOLEAN;
  v_new_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;

  /* 锁单 */
  PERFORM 1 FROM purchase_orders WHERE id = p_order_id FOR UPDATE;

  SELECT * INTO v_item FROM purchase_order_items
  WHERE id = p_item_id AND order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;

  /* 1. 删采购明细 */
  DELETE FROM purchase_order_items WHERE id = p_item_id;

  /* 2. 删关联工单配件行 */
  IF v_item.work_order_item_part_id IS NOT NULL THEN
    DELETE FROM work_order_item_parts WHERE id = v_item.work_order_item_part_id;
  END IF;

  /* 3. 采购单剩余明细:无则整单删除,有则重算状态 */
  SELECT COUNT(*),
         bool_or(handle_action IS NOT NULL),
         bool_or(handle_action IS NULL)
  INTO v_remaining, v_any_handled, v_any_unhandled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_remaining = 0 THEN
    DELETE FROM purchase_orders WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'order_deleted', true);
  END IF;

  v_new_status := CASE
    WHEN v_any_handled AND v_any_unhandled THEN 'partial_received'
    WHEN v_any_handled THEN 'pending_storage'
    ELSE 'submitted' END;
  UPDATE purchase_orders SET status = v_new_status WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order_deleted', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   七、部分收货（函数体与 0811 版一致 + 内置门禁）
   ============================================================ */
CREATE OR REPLACE FUNCTION receive_purchase_item_partial(
  p_order_id UUID,
  p_item_id UUID,
  p_qty INTEGER,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_new_received INTEGER;
  v_ordered INTEGER;
  v_all_handled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '收货数量必须大于 0');
  END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单不存在');
  END IF;
  IF v_order.status NOT IN ('submitted', 'approved', 'partial_received') THEN
    RETURN jsonb_build_object('success', false, 'error', '采购单当前状态不允许收货');
  END IF;

  /* 原子累加实收数量;超收直接报错,整单回滚 */
  UPDATE purchase_order_items
  SET received_qty = COALESCE(received_qty, 0) + p_qty
  WHERE id = p_item_id AND order_id = p_order_id
  RETURNING received_qty, quantity INTO v_new_received, v_ordered;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', '采购明细不属于本采购单');
  END IF;
  IF v_new_received > v_ordered THEN
    RAISE EXCEPTION '超过订购数量:订 % 件,已收 % 件,本次又收 % 件', v_ordered, v_new_received - p_qty, p_qty;
  END IF;

  /* 收满的行标记正常处理 */
  IF v_new_received = v_ordered THEN
    UPDATE purchase_order_items SET handle_action = 'normal'
    WHERE id = p_item_id AND handle_action IS NULL;
  END IF;

  /* 全单收满 → 待入库;否则部分收货 */
  SELECT bool_and(handle_action IS NOT NULL) INTO v_all_handled
  FROM purchase_order_items WHERE order_id = p_order_id;

  IF v_all_handled THEN
    UPDATE purchase_orders SET status = 'pending_storage' WHERE id = p_order_id;
    IF v_order.waybill_id IS NOT NULL THEN
      UPDATE logistics_waybills SET status = 'received', received_at = NOW()
      WHERE id = v_order.waybill_id;
    END IF;
  ELSE
    UPDATE purchase_orders SET status = 'partial_received' WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'all_received', v_all_handled);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   八、生成采退单（函数体与 0811 版一致 + 内置门禁）
   ============================================================ */
CREATE OR REPLACE FUNCTION create_purchase_return_orders(
  p_groups JSONB,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group JSONB;
  v_rec JSONB;
  v_return_id UUID;
  v_return_no TEXT;
  v_total_qty INTEGER;
  v_total_amount DECIMAL(12,2);
  v_record_ids UUID[];
  v_result JSONB := '[]'::JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_groups IS NULL OR jsonb_array_length(p_groups) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '采退单不能为空');
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    IF v_group->'records' IS NULL OR jsonb_array_length(v_group->'records') = 0 THEN
      RAISE EXCEPTION '采退单明细不能为空';
    END IF;

    SELECT COALESCE(SUM(COALESCE((r->>'quantity')::INTEGER, 0)), 0) INTO v_total_qty
    FROM jsonb_array_elements(v_group->'records') r;

    /* 建采退单(单号触发器生成) */
    INSERT INTO purchase_return_orders (
      supplier_id, supplier_name, total_quantity, status,
      logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer,
      notes, operator_id
    ) VALUES (
      NULLIF(v_group->>'supplier_id', '')::UUID,
      v_group->>'supplier_name',
      v_total_qty,
      'completed',
      NULLIF(TRIM(COALESCE(v_group->>'logistics_company', '')), ''),
      NULLIF(TRIM(COALESCE(v_group->>'tracking_no', '')), ''),
      COALESCE((v_group->>'return_shipping_fee')::DECIMAL, 0),
      NULLIF(v_group->>'shipping_fee_payer', ''),
      v_group->>'notes',
      p_operator_id
    )
    RETURNING id, return_no INTO v_return_id, v_return_no;

    /* 明细 */
    v_record_ids := '{}';
    v_total_amount := 0;
    FOR v_rec IN SELECT * FROM jsonb_array_elements(v_group->'records')
    LOOP
      INSERT INTO purchase_return_order_items (
        return_order_id, supplier_return_record_id, part_id,
        part_number, name, brand, specification,
        quantity, return_reason, unit_cost
      ) VALUES (
        v_return_id,
        (v_rec->>'record_id')::UUID,
        NULLIF(v_rec->>'part_id', '')::UUID,
        v_rec->>'part_number', v_rec->>'name', v_rec->>'brand', v_rec->>'specification',
        COALESCE((v_rec->>'quantity')::INTEGER, 0),
        v_rec->>'return_reason',
        COALESCE((v_rec->>'unit_cost')::DECIMAL, 0)
      );
      v_record_ids := array_append(v_record_ids, (v_rec->>'record_id')::UUID);
      v_total_amount := v_total_amount
        + COALESCE((v_rec->>'quantity')::INTEGER, 0) * COALESCE((v_rec->>'unit_cost')::DECIMAL, 0);
    END LOOP;

    /* 退货记录标记完成并关联采退单 */
    UPDATE supplier_return_records
    SET status = 'completed', return_order_id = v_return_id
    WHERE id = ANY(v_record_ids);

    /* 应收冲减 */
    IF NULLIF(v_group->>'supplier_id', '') IS NOT NULL AND v_total_amount > 0 THEN
      INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
      VALUES ((v_group->>'supplier_id')::UUID, 'credit', ROUND(v_total_amount, 2), '采购退货', v_return_id, 'purchase_return_order');
    END IF;

    v_result := v_result || jsonb_build_object('id', v_return_id, 'return_no', v_return_no);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'orders', v_result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   九、供应商档案保存（函数体与 0811 版一致 + 内置门禁）
   ============================================================ */
CREATE OR REPLACE FUNCTION save_supplier_full(
  p_supplier JSONB,
  p_contacts JSONB,
  p_category_ids JSONB,
  p_part_name_ids JSONB,
  p_brand_ids JSONB,
  p_vehicle_model_ids JSONB,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid UUID;
  v_contact JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁(2026-08-14 体检整改):采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF NULLIF(TRIM(COALESCE(p_supplier->>'name', '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '供应商名称不能为空');
  END IF;

  /* 1. 主表:有 id 更新,无 id 新建 */
  IF NULLIF(p_supplier->>'id', '') IS NOT NULL THEN
    v_sid := (p_supplier->>'id')::UUID;
    UPDATE suppliers SET
      name = TRIM(p_supplier->>'name'),
      contact = NULLIF(TRIM(COALESCE(p_supplier->>'contact', '')), ''),
      phone = NULLIF(TRIM(COALESCE(p_supplier->>'phone', '')), ''),
      address = NULLIF(TRIM(COALESCE(p_supplier->>'address', '')), ''),
      notes = NULLIF(TRIM(COALESCE(p_supplier->>'notes', '')), ''),
      region = COALESCE(NULLIF(p_supplier->>'region', ''), 'harbin'),
      wechat_id = NULLIF(TRIM(COALESCE(p_supplier->>'wechat_id', '')), ''),
      wechat_group_qr = NULLIF(p_supplier->>'wechat_group_qr', ''),
      wrong_shipment_count = COALESCE((p_supplier->>'wrong_shipment_count')::INTEGER, 0),
      quality_return_count = COALESCE((p_supplier->>'quality_return_count')::INTEGER, 0),
      recommendation_level = COALESCE((p_supplier->>'recommendation_level')::INTEGER, 0)
    WHERE id = v_sid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '供应商不存在');
    END IF;
  ELSE
    INSERT INTO suppliers (
      name, contact, phone, address, notes, region,
      wechat_id, wechat_group_qr,
      wrong_shipment_count, quality_return_count, recommendation_level
    ) VALUES (
      TRIM(p_supplier->>'name'),
      NULLIF(TRIM(COALESCE(p_supplier->>'contact', '')), ''),
      NULLIF(TRIM(COALESCE(p_supplier->>'phone', '')), ''),
      NULLIF(TRIM(COALESCE(p_supplier->>'address', '')), ''),
      NULLIF(TRIM(COALESCE(p_supplier->>'notes', '')), ''),
      COALESCE(NULLIF(p_supplier->>'region', ''), 'harbin'),
      NULLIF(TRIM(COALESCE(p_supplier->>'wechat_id', '')), ''),
      NULLIF(p_supplier->>'wechat_group_qr', ''),
      COALESCE((p_supplier->>'wrong_shipment_count')::INTEGER, 0),
      COALESCE((p_supplier->>'quality_return_count')::INTEGER, 0),
      COALESCE((p_supplier->>'recommendation_level')::INTEGER, 0)
    )
    RETURNING id INTO v_sid;
  END IF;

  /* 2. 联系人:先全量删再按传入重建(同事务,失败回滚不会丢数据) */
  DELETE FROM supplier_contacts WHERE supplier_id = v_sid;
  FOR v_contact IN SELECT * FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::JSONB))
  LOOP
    IF NULLIF(TRIM(COALESCE(v_contact->>'name', '')), '') IS NULL THEN CONTINUE; END IF;
    INSERT INTO supplier_contacts (supplier_id, name, phone, title, is_primary, notes)
    VALUES (
      v_sid,
      TRIM(v_contact->>'name'),
      NULLIF(TRIM(COALESCE(v_contact->>'phone', '')), ''),
      NULLIF(TRIM(COALESCE(v_contact->>'title', '')), ''),
      COALESCE((v_contact->>'is_primary')::BOOLEAN, false),
      NULLIF(TRIM(COALESCE(v_contact->>'notes', '')), '')
    );
  END LOOP;

  /* 3. 经营分类 */
  DELETE FROM supplier_part_categories WHERE supplier_id = v_sid;
  INSERT INTO supplier_part_categories (supplier_id, part_category_id)
  SELECT v_sid, (value)::UUID FROM jsonb_array_elements_text(COALESCE(p_category_ids, '[]'::JSONB)) AS t(value);

  /* 4. 经营配件名称 */
  DELETE FROM supplier_part_names WHERE supplier_id = v_sid;
  INSERT INTO supplier_part_names (supplier_id, part_name_id)
  SELECT v_sid, (value)::UUID FROM jsonb_array_elements_text(COALESCE(p_part_name_ids, '[]'::JSONB)) AS t(value);

  /* 5. 经营品牌 */
  DELETE FROM supplier_part_brands WHERE supplier_id = v_sid;
  INSERT INTO supplier_part_brands (supplier_id, part_brand_id)
  SELECT v_sid, (value)::UUID FROM jsonb_array_elements_text(COALESCE(p_brand_ids, '[]'::JSONB)) AS t(value);

  /* 6. 覆盖车型(vehicle_model_id 为 INTEGER) */
  DELETE FROM supplier_vehicle_models WHERE supplier_id = v_sid;
  INSERT INTO supplier_vehicle_models (supplier_id, vehicle_model_id)
  SELECT v_sid, (value)::INTEGER FROM jsonb_array_elements_text(COALESCE(p_vehicle_model_ids, '[]'::JSONB)) AS t(value);

  RETURN jsonb_build_object('success', true, 'supplier_id', v_sid);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   权限收尾：CREATE OR REPLACE 保留原权限（0813 的 REVOKE 仍有效）；
   create_purchase_orders 是新签名函数，默认 PUBLIC 可执行，必须回收
   ============================================================ */
REVOKE EXECUTE ON FUNCTION public.create_purchase_orders(jsonb, uuid[], uuid) FROM anon, PUBLIC;

/* ============================================================
   验证方法(执行完本脚本后跑):
   SELECT proname FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname IN ('complete_purchase_inbound','create_purchase_orders',
                     'revoke_pending_storage','receive_purchase_item','revoke_purchase_receipt',
                     'delete_purchase_item','receive_purchase_item_partial',
                     'create_purchase_return_orders','save_supplier_full')
     AND pg_get_functiondef(oid) LIKE '%权限门禁%';
   应返回 9 行。
   再确认旧两参版 create_purchase_orders 已不存在:
   SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_purchase_orders' AND p.pronargs=2;
   应返回 0。
   ============================================================
*/
