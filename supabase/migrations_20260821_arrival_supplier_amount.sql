/* 建到货单支持销售单总金额（2026-08-21 按销售单执行入库·录入环节）
 *
 * create_arrival_receipt 加 p_supplier_order_amount（可空，老调用兼容），
 * 写入 arrival_receipts.supplier_order_amount（20260821_supplier_order_inbound 已建列）。
 * 单号/照片维持原状（非必填、可后补），总金额同样非必填。
*/

CREATE OR REPLACE FUNCTION public.create_arrival_receipt(
  p_waybill_id UUID,
  p_supplier_id UUID,
  p_supplier_order_no TEXT,
  p_photos JSONB,
  p_supplier_order_amount DECIMAL DEFAULT NULL
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arrival_id UUID;
  v_receipt_no TEXT;
  v_date_str TEXT;
  v_seq INTEGER;
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;
  /* 权限门禁:采购/供应商写操作仅 管理员/老板/仓管 可执行 */
  IF NOT public.has_role('admin', 'boss', 'warehouse') THEN
    RETURN jsonb_build_object('success', false, 'error', '无权限:仅管理员、老板、仓管可操作采购');
  END IF;
  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '请选择供应商');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id) THEN
    RETURN jsonb_build_object('success', false, 'error', '供应商不存在');
  END IF;

  /* 单号：当日序号，加咨询锁防并发重号 */
  v_date_str := to_char(NOW(), 'YYYYMMDD');
  PERFORM pg_advisory_xact_lock(hashtext('arrival_receipt_no_' || v_date_str));
  SELECT COUNT(*) + 1 INTO v_seq FROM arrival_receipts WHERE receipt_no LIKE 'DH-' || v_date_str || '-%';
  v_receipt_no := 'DH-' || v_date_str || '-' || lpad(v_seq::TEXT, 3, '0');

  INSERT INTO arrival_receipts (receipt_no, waybill_id, supplier_id, supplier_order_no, supplier_order_amount, photos, status, created_by)
  VALUES (
    v_receipt_no, p_waybill_id, p_supplier_id,
    NULLIF(TRIM(COALESCE(p_supplier_order_no, '')), ''),
    p_supplier_order_amount,
    p_photos, 'receiving', auth.uid()
  )
  RETURNING id INTO v_arrival_id;

  /* 拉入该供应商所有可收的在途采购行 */
  INSERT INTO arrival_receipt_items (arrival_id, purchase_order_item_id, part_id, part_name_snapshot, expected_qty)
  SELECT v_arrival_id, poi.id, poi.part_id, poi.name, poi.quantity
  FROM purchase_order_items poi
  JOIN purchase_orders o ON o.id = poi.order_id
  WHERE o.supplier_id = p_supplier_id
    AND o.status IN ('submitted', 'approved', 'partial_received')
    AND poi.handle_action IS NULL
    /* 没被别的到货单以"未处理"状态占着 */
    AND NOT EXISTS (
      SELECT 1 FROM arrival_receipt_items ai
      WHERE ai.purchase_order_item_id = poi.id AND ai.handling IS NULL
    )
    /* 存量单（已有老路径处理记录）走老路径收完，不进到货单 */
    AND NOT EXISTS (
      SELECT 1 FROM purchase_order_items x
      WHERE x.order_id = poi.order_id AND x.handle_action IS NOT NULL AND x.arrival_item_id IS NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION '该供应商没有可收货的在途采购行';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'arrival_id', v_arrival_id,
    'receipt_no', v_receipt_no,
    'item_count', v_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.create_arrival_receipt(uuid, uuid, text, jsonb, numeric) FROM anon, PUBLIC;

/* 验证：SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname='create_arrival_receipt';
   应看到 5 个参数（末尾 p_supplier_order_amount）。 */
