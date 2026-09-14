/* 供应商档案财务字段（供应商款项改造 批次2，2026-09-15）
 *
 * 背景：
 *   供应商档案没有任何财务字段——账期怎么算、钱转到哪个账户，全靠微信群聊天记录翻。
 *
 * 内容：
 *   1. suppliers 加 6 列：settle_type(结算方式) / credit_days(账期天数) /
 *      payee_name(收款户名) / bank_name(开户行) / bank_account(银行账号) / payment_note(收款说明)
 *   2. save_supplier_full 透传这 6 个字段（参数列表不变——字段在 p_supplier JSONB 里，
 *      所以 CREATE OR REPLACE 即可，不涉及改参数列表的三防雷区）
 *
 * 幂等三防：加列 IF NOT EXISTS；函数 CREATE OR REPLACE（签名不变）；台账 ON CONFLICT。
*/

/* ============================================================
   一、suppliers 加财务列
   ============================================================ */
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS settle_type TEXT;      /* cash 现结 / monthly 月结 / credit_days 账期 */
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS credit_days INTEGER;   /* settle_type=credit_days 时的天数 */
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payee_name TEXT;       /* 收款户名 */
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS bank_name TEXT;        /* 开户行 */
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS bank_account TEXT;     /* 银行账号 */
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS payment_note TEXT;     /* 收款补充说明（如"微信同手机号"） */

/* settle_type 只允许三个值（已存在的脏数据不管，新写入受约束） */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_settle_type_check'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_settle_type_check
      CHECK (settle_type IS NULL OR settle_type IN ('cash', 'monthly', 'credit_days'));
  END IF;
END $$;

/* ============================================================
   二、save_supplier_full 透传财务字段（签名不变，沿用 20260819 版加列）
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
      recommendation_level = COALESCE((p_supplier->>'recommendation_level')::INTEGER, 0),
      /* 2026-09-15 批次2:财务字段透传 */
      settle_type = NULLIF(TRIM(COALESCE(p_supplier->>'settle_type', '')), ''),
      credit_days = CASE
        WHEN NULLIF(TRIM(COALESCE(p_supplier->>'settle_type', '')), '') = 'credit_days'
        THEN COALESCE((p_supplier->>'credit_days')::INTEGER, NULL)
        ELSE NULL
      END,
      payee_name = NULLIF(TRIM(COALESCE(p_supplier->>'payee_name', '')), ''),
      bank_name = NULLIF(TRIM(COALESCE(p_supplier->>'bank_name', '')), ''),
      bank_account = NULLIF(TRIM(COALESCE(p_supplier->>'bank_account', '')), ''),
      payment_note = NULLIF(TRIM(COALESCE(p_supplier->>'payment_note', '')), '')
    WHERE id = v_sid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', '供应商不存在');
    END IF;
  ELSE
    INSERT INTO suppliers (
      name, contact, phone, address, notes, region,
      wechat_id, wechat_group_qr,
      wrong_shipment_count, quality_return_count, recommendation_level,
      settle_type, credit_days, payee_name, bank_name, bank_account, payment_note
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
      COALESCE((p_supplier->>'recommendation_level')::INTEGER, 0),
      NULLIF(TRIM(COALESCE(p_supplier->>'settle_type', '')), ''),
      CASE
        WHEN NULLIF(TRIM(COALESCE(p_supplier->>'settle_type', '')), '') = 'credit_days'
        THEN COALESCE((p_supplier->>'credit_days')::INTEGER, NULL)
        ELSE NULL
      END,
      NULLIF(TRIM(COALESCE(p_supplier->>'payee_name', '')), ''),
      NULLIF(TRIM(COALESCE(p_supplier->>'bank_name', '')), ''),
      NULLIF(TRIM(COALESCE(p_supplier->>'bank_account', '')), ''),
      NULLIF(TRIM(COALESCE(p_supplier->>'payment_note', '')), '')
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
   三、台账登记
   ============================================================ */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_a_supplier_finance_fields.sql') ON CONFLICT DO NOTHING;

/* ============================================================
   验证方法(执行完本脚本后跑):
   1. 六列就位:
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'suppliers'
        AND column_name IN ('settle_type','credit_days','payee_name','bank_name','bank_account','payment_note');
      应返回 6 行。
   2. 函数含新字段:
      SELECT proname FROM pg_proc
      WHERE proname = 'save_supplier_full'
        AND pg_get_functiondef(oid) LIKE '%settle_type%';
      应返回 1 行。
   ============================================================
*/
