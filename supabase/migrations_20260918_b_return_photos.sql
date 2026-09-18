/* ============================================================
 * 退货照片与运费信息（2026-09-18 用户拍板）
 * 背景：已入库退货 / 确认退货给供应商都要留证据照片（货物照 + 外包装照）。
 *   已入库退货时可选拍；待退货生成采退单时必填（前端 + Server Action 双重校验）。
 *   退货运费分对方付 / 我方付，我方付必填金额（采退单运费字段此前已有）。
 * 改动：
 *   1. supplier_return_records 加 package_photos（原 photos 列继续当货物照片用）
 *   2. purchase_return_orders 加 goods_photos / package_photos
 *   3. create_inbound_return：明细 JSON 支持 photos / package_photos 写入退货记录
 *   4. create_purchase_return_orders：分组 JSON 支持 goods_photos / package_photos
 *      写入采退单，并回写同单退货记录（已退货列表按记录查照片）
 * 幂等：ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE（参数列表未变），可重跑。
 * ============================================================ */

ALTER TABLE public.supplier_return_records ADD COLUMN IF NOT EXISTS package_photos TEXT[];
ALTER TABLE public.purchase_return_orders ADD COLUMN IF NOT EXISTS goods_photos TEXT[];
ALTER TABLE public.purchase_return_orders ADD COLUMN IF NOT EXISTS package_photos TEXT[];

COMMENT ON COLUMN public.supplier_return_records.package_photos IS '外包装照片（photos 列为货物照片）';
COMMENT ON COLUMN public.purchase_return_orders.goods_photos IS '退货物照片（确认退货时必填）';
COMMENT ON COLUMN public.purchase_return_orders.package_photos IS '退货外包装照片（确认退货时必填）';

/* ─── 二、create_inbound_return：退货记录支持照片（参数列表未变） ─── */
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

    /* 原因白名单：已入库退货只允许 质量问题/客户悔单/其他 */
    v_reason := COALESCE(NULLIF(TRIM(v_item->>'return_reason'), ''), 'other');
    IF v_reason NOT IN ('quality', 'cancel', 'other') THEN
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

/* ─── 三、create_purchase_return_orders：采退单支持照片 + 回写退货记录（参数列表未变） ─── */
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
  v_goods_photos TEXT[];
  v_package_photos TEXT[];
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

    /* 2026-09-18：确认退货必填校验（货物照片/外包装照片/物流公司；我方付必填运费金额） */
    IF jsonb_typeof(v_group->'goods_photos') <> 'array'
       OR jsonb_array_length(v_group->'goods_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少货物照片，确认退货前必须拍照上传', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF jsonb_typeof(v_group->'package_photos') <> 'array'
       OR jsonb_array_length(v_group->'package_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少外包装照片，确认退货前必须拍照上传', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF NULLIF(TRIM(COALESCE(v_group->>'logistics_company', '')), '') IS NULL THEN
      RAISE EXCEPTION '供应商「%」未选物流公司，确认退货时物流公司必选', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF v_group->>'shipping_fee_payer' = 'self'
       AND COALESCE((v_group->>'return_shipping_fee')::DECIMAL, 0) <= 0 THEN
      RAISE EXCEPTION '供应商「%」退货运费为我方付，必须填写运费金额', COALESCE(v_group->>'supplier_name', '');
    END IF;

    v_goods_photos := (SELECT ARRAY(SELECT jsonb_array_elements_text(v_group->'goods_photos')));
    v_package_photos := (SELECT ARRAY(SELECT jsonb_array_elements_text(v_group->'package_photos')));

    SELECT COALESCE(SUM(COALESCE((r->>'quantity')::INTEGER, 0)), 0) INTO v_total_qty
    FROM jsonb_array_elements(v_group->'records') r;

    /* 建采退单(单号触发器生成)，2026-09-18 起带货物/外包装照片 */
    INSERT INTO purchase_return_orders (
      supplier_id, supplier_name, total_quantity, status,
      logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer,
      notes, operator_id, goods_photos, package_photos
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
      p_operator_id,
      v_goods_photos,
      v_package_photos
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

    /* 退货记录标记完成并关联采退单；
       同步回写最终照片/物流信息（已退货列表按记录查，2026-09-18） */
    UPDATE supplier_return_records
    SET status = 'completed', return_order_id = v_return_id,
        photos = v_goods_photos,
        package_photos = v_package_photos,
        logistics_company = NULLIF(TRIM(COALESCE(v_group->>'logistics_company', '')), ''),
        tracking_no = NULLIF(TRIM(COALESCE(v_group->>'tracking_no', '')), '')
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

REVOKE EXECUTE ON FUNCTION public.create_purchase_return_orders(jsonb, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_return_orders(jsonb, uuid) TO authenticated;

/* ============================================================
 * 验证（执行后自查）：
 * 1. 列已加：
 *    SELECT column_name FROM information_schema.columns
 *    WHERE table_name IN ('supplier_return_records','purchase_return_orders')
 *      AND column_name IN ('package_photos','goods_photos');
 *    应返回 3 行。
 * 2. 函数权限（防止 PUBLIC 暗道）：
 *    SELECT proname,
 *      has_function_privilege('anon', oid, 'EXECUTE') AS anon可执行,
 *      has_function_privilege('authenticated', oid, 'EXECUTE') AS 登录可执行
 *    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 *    WHERE n.nspname = 'public'
 *      AND proname IN ('create_inbound_return','create_purchase_return_orders')
 *      AND oidvectortypes(proargtypes) = 'jsonb, uuid';
 *    应返回 2 行：anon=false，authenticated=true。
 * ============================================================ */

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260918_b_return_photos.sql', '退货照片字段(package_photos/goods_photos)+两个退货RPC写照片+确认退货必填校验')
ON CONFLICT (file_name) DO NOTHING;
