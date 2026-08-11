/* 供应商档案保存 —— 原子事务函数 */
/* 创建日期: 2026-08-11 */
/* 背景:
     原供应商保存在浏览器执行:主表 insert/update → 5 张关联表各自"先全量删再插"。
     关联表操作全部 try/catch 空捕获静默吞错,delete-then-insert 无事务——
     中途失败会导致联系人/经营分类等关联数据被清空且不报任何错误。
   本迁移:
     save_supplier_full —— 主表 + 5 张关联表一个事务完成,任一失败整体回滚
   说明:
     原客户端有"扩展列不存在则降级只写基础列"的兼容逻辑,本函数直接写全量字段;
     若目标库尚未执行 suppliers 扩展列迁移(20260510/20260512),调用会明确报错,
     请先补齐迁移再使用(报错优于静默丢数据)。
*/

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
