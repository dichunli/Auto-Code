/* ============================================================
 * 退货运费自动入物流应付（2026-09-18 用户拍板）
 * 背景：确认退货时我方付运费，原来要事后到采退单详情页手动点"记入物流应付"，
 *   容易漏。改为生成采退单时同一事务自动入账：
 *   我方付 + 运费>0 + 物流公司能匹配到档案 → 直接写 logistics_transactions(debit)
 *   并把 freight_recorded 置位；匹配不到档案不报错（详情页仍可手动补记）。
 *   本地交接（logistics_company='本地交接'）匹配不到档案，天然跳过。
 * 函数体与 migrations_20260918_b_return_photos.sql 一致，仅新增自动入账段。
 * 幂等：CREATE OR REPLACE（参数列表未变），可重跑。
 * ============================================================ */

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
  v_handover_photos TEXT[];
  v_company_id UUID;
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

    /* 2026-09-18：确认退货必填校验（货物/外包装/交接三类照片 + 物流公司；我方付必填运费金额） */
    IF jsonb_typeof(v_group->'goods_photos') <> 'array'
       OR jsonb_array_length(v_group->'goods_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少货物照片，确认退货前必须拍照上传', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF jsonb_typeof(v_group->'package_photos') <> 'array'
       OR jsonb_array_length(v_group->'package_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少外包装照片，确认退货前必须拍照上传', COALESCE(v_group->>'supplier_name', '');
    END IF;
    IF jsonb_typeof(v_group->'handover_photos') <> 'array'
       OR jsonb_array_length(v_group->'handover_photos') = 0 THEN
      RAISE EXCEPTION '供应商「%」缺少交接照片，交货给物流公司/供应商时必须拍照上传', COALESCE(v_group->>'supplier_name', '');
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
    v_handover_photos := (SELECT ARRAY(SELECT jsonb_array_elements_text(v_group->'handover_photos')));

    SELECT COALESCE(SUM(COALESCE((r->>'quantity')::INTEGER, 0)), 0) INTO v_total_qty
    FROM jsonb_array_elements(v_group->'records') r;

    /* 建采退单(单号触发器生成)，2026-09-18 起带货物/外包装/交接三类照片 */
    INSERT INTO purchase_return_orders (
      supplier_id, supplier_name, total_quantity, status,
      logistics_company, tracking_no, return_shipping_fee, shipping_fee_payer,
      notes, operator_id, goods_photos, package_photos, handover_photos
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
      v_package_photos,
      v_handover_photos
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
        handover_photos = v_handover_photos,
        logistics_company = NULLIF(TRIM(COALESCE(v_group->>'logistics_company', '')), ''),
        tracking_no = NULLIF(TRIM(COALESCE(v_group->>'tracking_no', '')), '')
    WHERE id = ANY(v_record_ids);

    /* 应收冲减 */
    IF NULLIF(v_group->>'supplier_id', '') IS NOT NULL AND v_total_amount > 0 THEN
      INSERT INTO supplier_transactions (supplier_id, transaction_type, amount, description, reference_id, reference_type)
      VALUES ((v_group->>'supplier_id')::UUID, 'credit', ROUND(v_total_amount, 2), '采购退货', v_return_id, 'purchase_return_order');
    END IF;

    /* 退货运费自动入物流应付（2026-09-18 用户拍板）：
       我方付 + 运费>0 + 物流公司能匹配到档案 → 同一事务记一笔应付并置 freight_recorded；
       匹配不到档案不报错（采退单详情页仍可手动补记）；
       本地交接（logistics_company='本地交接'）匹配不到档案，天然跳过 */
    IF v_group->>'shipping_fee_payer' = 'self'
       AND COALESCE((v_group->>'return_shipping_fee')::DECIMAL, 0) > 0 THEN
      SELECT id INTO v_company_id FROM logistics_companies
      WHERE name = BTRIM(v_group->>'logistics_company') LIMIT 1;
      IF v_company_id IS NOT NULL THEN
        INSERT INTO logistics_transactions (
          logistics_company_id, transaction_type, amount, description,
          reference_id, reference_type, created_by
        ) VALUES (
          v_company_id, 'debit', (v_group->>'return_shipping_fee')::DECIMAL,
          '退货运费(采退单 ' || COALESCE(v_return_no, '') || ')',
          v_return_id, 'purchase_return_order', p_operator_id
        );
        UPDATE purchase_return_orders SET freight_recorded = true WHERE id = v_return_id;
      END IF;
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

/* 登记台账 */
INSERT INTO migration_log (file_name, note)
VALUES ('migrations_20260918_d_return_freight_auto.sql', '生成采退单时我方付运费自动入物流应付(匹配不到物流档案则跳过可手动补)')
ON CONFLICT (file_name) DO NOTHING;
