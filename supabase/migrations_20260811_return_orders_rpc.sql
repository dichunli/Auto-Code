/* 采购退货 —— 原子事务函数 */
/* 创建日期: 2026-08-11 */
/* 背景:
     「批量撤销退货」是采购模块最高危操作:最多级联写 10 张表(库存/仓位/入库单/明细/批次/流水/
     应付款/采购明细/采购单状态/退货记录),且几乎全部不检查错误,库存和仓位还是"先读再写",
     中途失败或并发操作必然错账。
     「生成采退单」按供应商循环,某一供应商失败则前面的单已生成、后面的中断,留半成品。
   本迁移:
     一、revoke_supplier_returns      —— 批量撤销退货记录(含整单入库回滚),一个事务
     二、create_purchase_return_orders —— 批量生成采退单(含应收冲减),一个事务
*/

/* ============================================================
   一、批量撤销退货记录(原子事务)
   语义与原客户端一致:
   - 关联采购单已入库的 → 整单回滚入库(扣回库存/仓位,删入库单/批次/流水/应付款),
     采购明细处理结果清空,采购单回 submitted
   - 未入库且为弃货类的 → 退货数量加回库存,清空明细,重算状态
   改进:库存/仓位全部 SQL 原子增减;批次/流水被占用(如配件已领料)时
   删除会触发外键错误,整单回滚并明确报错,不再静默留脏数据。
   参数: p_record_ids 退货记录 id 数组
   ============================================================ */
CREATE OR REPLACE FUNCTION revoke_supplier_returns(
  p_record_ids UUID[],
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_poi RECORD;
  v_order_id UUID;
  v_revoked_orders UUID[] := '{}';
  v_inbound_ids UUID[];
  v_in_item RECORD;
  v_part_id UUID;
  v_any_handled BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF p_record_ids IS NULL OR array_length(p_record_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请先选择要撤销的记录');
  END IF;

  /* 按采购单逐单处理(同一采购单只处理一次,与原逻辑一致) */
  FOR v_rec IN
    SELECT id, work_order_item_part_id, quantity, return_reason
    FROM supplier_return_records
    WHERE id = ANY(p_record_ids)
  LOOP
    /* 找关联采购明细(取第一条,与原客户端一致) */
    SELECT id, order_id, handle_action INTO v_poi
    FROM purchase_order_items
    WHERE work_order_item_part_id = v_rec.work_order_item_part_id
    LIMIT 1;

    v_order_id := v_poi.order_id;
    IF v_order_id IS NULL OR v_order_id = ANY(v_revoked_orders) THEN
      CONTINUE;
    END IF;

    /* 该采购单的全部入库单 */
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_inbound_ids
    FROM inbound_orders WHERE purchase_order_id = v_order_id;

    IF array_length(v_inbound_ids, 1) > 0 THEN
      /* ── 已入库:整单回滚入库 ── */
      FOR v_in_item IN
        SELECT part_id, quantity, warehouse_id, location
        FROM inbound_order_items
        WHERE inbound_order_id = ANY(v_inbound_ids)
      LOOP
        IF v_in_item.part_id IS NULL OR COALESCE(v_in_item.quantity, 0) <= 0 THEN
          CONTINUE;
        END IF;

        /* 原子扣回库存 */
        UPDATE parts SET quantity = GREATEST(0, quantity - v_in_item.quantity)
        WHERE id = v_in_item.part_id;

        /* 原子扣回仓位(空仓位统一空串口径) */
        IF v_in_item.warehouse_id IS NOT NULL THEN
          UPDATE part_stock_locations
          SET quantity = GREATEST(0, quantity - v_in_item.quantity)
          WHERE part_id = v_in_item.part_id
            AND warehouse_id = v_in_item.warehouse_id
            AND COALESCE(location, '') = COALESCE(v_in_item.location, '');
        END IF;
      END LOOP;

      /* 删除入库相关数据(若批次已被领料占用,外键报错整单回滚) */
      DELETE FROM inbound_order_items WHERE inbound_order_id = ANY(v_inbound_ids);
      DELETE FROM inbound_orders WHERE id = ANY(v_inbound_ids);
      DELETE FROM part_batches WHERE reference_id = v_order_id AND inbound_type = 'purchase';
      DELETE FROM inventory_logs WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);
      DELETE FROM supplier_transactions WHERE reference_type = 'inbound_order' AND reference_id = ANY(v_inbound_ids);

      /* 清空采购明细处理结果,采购单回已提交 */
      UPDATE purchase_order_items
      SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
      WHERE order_id = v_order_id;
      UPDATE purchase_orders SET status = 'submitted' WHERE id = v_order_id;
    ELSE
      /* ── 未入库:弃货类加回库存 ── */
      IF v_poi.handle_action IN ('broken_discard', 'wrong_discard') THEN
        SELECT part_id INTO v_part_id FROM work_order_item_parts
        WHERE id = v_rec.work_order_item_part_id;
        IF v_part_id IS NOT NULL AND v_rec.quantity > 0 THEN
          UPDATE parts SET quantity = quantity + v_rec.quantity WHERE id = v_part_id;
        END IF;

        UPDATE purchase_order_items
        SET handle_action = NULL, received_qty = NULL, discount_amount = NULL, evidence_photos = NULL
        WHERE id = v_poi.id;

        SELECT bool_or(handle_action IS NOT NULL) INTO v_any_handled
        FROM purchase_order_items WHERE order_id = v_order_id;
        UPDATE purchase_orders
        SET status = CASE WHEN v_any_handled THEN 'partial_received' ELSE 'submitted' END
        WHERE id = v_order_id;
      END IF;
    END IF;

    v_revoked_orders := array_append(v_revoked_orders, v_order_id);
  END LOOP;

  /* 删除退货记录本身 */
  DELETE FROM supplier_return_records WHERE id = ANY(p_record_ids);

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

/* ============================================================
   二、批量生成采退单(原子事务)
   参数:
     p_groups JSONB 数组,每个元素一张采退单:
       supplier_id / supplier_name / logistics_company / tracking_no /
       return_shipping_fee / shipping_fee_payer / notes
       records: [{ record_id, part_id, part_number, name, brand,
                   specification, quantity, return_reason, unit_cost }]
   全部供应商的采退单在同一事务,任一失败整体回滚,不再出现部分生成。
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
