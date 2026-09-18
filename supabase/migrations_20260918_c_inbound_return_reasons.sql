/* ============================================================
 * 已入库退货原因白名单放宽（2026-09-18 用户拍板）
 * 背景：退货原因从 3 种（质量问题/客户悔单/其他）扩到 6 种：
 *   多发 excess / 破损 damaged / 发错 wrong_ship / 质量原因 quality / 客户悔单 cancel / 其它 other
 * 函数体与 migrations_20260918_b_return_photos.sql 完全一致，仅放宽白名单。
 * 幂等：CREATE OR REPLACE（参数列表未变），可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION create_inbound_return(
  p_items JSONB,
  p_operator_id UUID
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_poi RECORD;
  v_order RECORD;
  v_batch RECORD;
  v_qty INTEGER;
  v_已退 INTEGER;
  v_可退 INTEGER;
  v_before_qty INTEGER;
  v_reason TEXT;
  v_supplier_name TEXT;
  v_record_id UUID;
  v_ids UUID[] := '{}';
BEGIN
  /* 0. 登录校验 + 角色门禁(对齐采购其他事务函数) */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购退货');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', '退货明细不能为空');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION '退货数量必须大于0';
    END IF;

    /* 原因白名单（2026-09-18 放宽为 6 种）：多发/破损/发错/质量原因/客户悔单/其它 */
    v_reason := NULLIF(TRIM(COALESCE(v_item->>'return_reason', '')), '');
    IF v_reason IS NULL THEN
      RAISE EXCEPTION '请选择退货原因';
    END IF;
    IF v_reason NOT IN ('excess', 'damaged', 'wrong_ship', 'quality', 'cancel', 'other') THEN
      RAISE EXCEPTION '非法的退货原因: %', v_reason;
    END IF;

    /* 1. 锁采购明细行(防并发重复退货) */
    SELECT * INTO v_poi FROM purchase_order_items
    WHERE id = (v_item->>'purchase_order_item_id')::UUID
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '采购明细不存在';
    END IF;
    IF v_poi.part_id IS NULL THEN
      RAISE EXCEPTION '「%」未关联配件档案，不能退货', COALESCE(v_poi.name, '(无名)');
    END IF;

    /* 2. 采购单必须已入库 */
    SELECT id, status, supplier_id INTO v_order
    FROM purchase_orders WHERE id = v_poi.order_id;
    IF v_order.status <> 'completed' THEN
      RAISE EXCEPTION '仅「已入库」的采购单可以退货(单号 % 当前状态 %)', v_poi.id, v_order.status;
    END IF;

    /* 3. 可退数 = 实际入库数 − 已退数（撤销的记录已物理删除，不会虚占）
       同一明细在一次调用里出现多行时，先插入的记录同事务可见，天然防超退 */
    SELECT COALESCE(SUM(quantity), 0) INTO v_已退
    FROM supplier_return_records
    WHERE purchase_order_item_id = v_poi.id;
    v_可退 := COALESCE(v_poi.received_qty, v_poi.quantity) - v_已退;
    IF v_qty > v_可退 THEN
      RAISE EXCEPTION '「%」最多还能退 % 件（已入库 % 件，已退 % 件）',
        COALESCE(v_poi.name, '(无名)'), v_可退,
        COALESCE(v_poi.received_qty, v_poi.quantity), v_已退;
    END IF;

    /* 4. 锁批次扣剩余 */
    SELECT id, part_id, remaining, batch_no INTO v_batch
    FROM part_batches WHERE id = (v_item->>'batch_id')::UUID FOR UPDATE;
    IF v_batch.id IS NULL OR v_batch.part_id <> v_poi.part_id THEN
      RAISE EXCEPTION '批次不存在或不属于「%」', COALESCE(v_poi.name, '(无名)');
    END IF;
    IF v_batch.remaining < v_qty THEN
      RAISE EXCEPTION '「%」批次 % 剩余仅 % 件，不足退货',
        COALESCE(v_poi.name, '(无名)'), COALESCE(v_batch.batch_no, '(未命名)'), v_batch.remaining;
    END IF;

    /* 5. 锁配件扣总库存(不足报错不钳制，账实不符宁可拦下人工核对) */
    SELECT quantity INTO v_before_qty FROM parts WHERE id = v_poi.part_id FOR UPDATE;
    IF v_before_qty IS NULL THEN
      RAISE EXCEPTION '配件档案不存在';
    END IF;
    IF v_before_qty < v_qty THEN
      RAISE EXCEPTION '「%」当前库存 % 件不足退 % 件(可能已领料)，请先人工核对库存',
        COALESCE(v_poi.name, '(无名)'), v_before_qty, v_qty;
    END IF;

    UPDATE part_batches SET remaining = remaining - v_qty WHERE id = v_batch.id;
    UPDATE parts SET quantity = quantity - v_qty WHERE id = v_poi.part_id;

    /* 6. 插待退货记录(快照从采购明细取，供应商从采购单取，准确不靠猜)
       2026-09-18：支持货物照片 photos / 外包装照片 package_photos（退货时可选拍） */
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_order.supplier_id;

    INSERT INTO supplier_return_records (
      work_order_item_part_id, purchase_order_item_id, source,
      return_reason, quantity,
      supplier_id, supplier_name,
      part_id, part_number, part_name, brand, specification, unit, unit_cost,
      batch_id, notes, status, created_by,
      photos, package_photos
    ) VALUES (
      v_poi.work_order_item_part_id, v_poi.id, 'inbound_return',
      v_reason, v_qty,
      v_order.supplier_id, COALESCE(v_supplier_name, ''),
      v_poi.part_id, v_poi.part_number, v_poi.name, v_poi.brand,
      v_poi.specification, v_poi.unit, v_poi.unit_cost,
      v_batch.id,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), ''),
      'pending', p_operator_id,
      CASE WHEN jsonb_typeof(v_item->'photos') = 'array'
           THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(v_item->'photos')))
           ELSE NULL END,
      CASE WHEN jsonb_typeof(v_item->'package_photos') = 'array'
           THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(v_item->'package_photos')))
           ELSE NULL END
    )
    RETURNING id INTO v_record_id;
    v_ids := array_append(v_ids, v_record_id);

    /* 7. 库存流水 */
    INSERT INTO inventory_logs (part_id, type, change_qty, before_qty, after_qty, reference_type, reference_id, operator_id, notes)
    VALUES (
      v_poi.part_id, 'return_out', -v_qty, v_before_qty, v_before_qty - v_qty,
      'supplier_return_record', v_record_id, p_operator_id,
      '已入库退货: ' || COALESCE(v_poi.name, '') ||
        CASE WHEN v_batch.batch_no IS NOT NULL THEN ' 批次:' || v_batch.batch_no ELSE '' END
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'record_ids', v_ids);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_inbound_return(jsonb, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_inbound_return(jsonb, uuid) TO authenticated;

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260918_c_inbound_return_reasons.sql', '已入库退货原因白名单放宽为6种(多发/破损/发错/质量原因/客户悔单/其它)，原因必填')
ON CONFLICT (file_name) DO NOTHING;
