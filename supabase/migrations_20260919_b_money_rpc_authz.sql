/* ============================================================
 * create_work_order 补登录校验（2026-09-19，9-15 诊断🟠#6/#7 深挖）
 *
 * 背景：create_work_order 函数体内此前完全没有 auth.uid() 校验，匿名可开单。
 *   只加登录校验、不加角色门禁：开单角色口径未拍板（接待为主，不排除技师代开）。
 * ⚠️ settle_work_order 的门禁不在这里——它的旧版定义在 CLI 平行目录
 *   supabase/migrations/20260501000002（CI 重放时后灌会覆盖主序列），
 *   门禁版见 supabase/migrations/20260919000001_settle_work_order_authz.sql。
 * 幂等：CREATE OR REPLACE（参数列表未变，无需 DROP）；
 *   带 SET search_path = public（OR REPLACE 不带会丢 0902 迁移设的属性）。
 * ============================================================ */

CREATE OR REPLACE FUNCTION create_work_order(
  p_customer_id UUID,
  p_vehicle_id UUID,
  p_mileage_in INTEGER,
  p_fuel_level INTEGER,
  p_customer_complaint TEXT,
  p_inspection_notes TEXT,
  p_receptionist_id UUID,
  p_requirements JSONB,
  p_sender_name TEXT DEFAULT NULL,
  p_sender_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $func$
DECLARE
  v_order_id UUID;
  v_req JSONB;
  v_seq INTEGER := 1;
BEGIN
  /* 0. 登录校验（2026-09-19 补：此前匿名也可开单） */
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  INSERT INTO work_orders (
    vehicle_id, customer_id, mileage_in, fuel_level,
    customer_complaint, inspection_notes, receptionist_id, status,
    sender_name, sender_phone
  ) VALUES (
    p_vehicle_id, p_customer_id, COALESCE(p_mileage_in, 0), p_fuel_level,
    NULLIF(p_customer_complaint, ''), NULLIF(p_inspection_notes, ''), p_receptionist_id, 'received',
    NULLIF(p_sender_name, ''), NULLIF(p_sender_phone, '')
  )
  RETURNING id INTO v_order_id;

  FOR v_req IN SELECT * FROM jsonb_array_elements(p_requirements)
  LOOP
    IF NULLIF(trim(v_req->>'description'), '') IS NOT NULL THEN
      INSERT INTO work_order_requirements (
        work_order_id, seq, description, submitted_by, assigned_to, assignment_type
      ) VALUES (
        v_order_id, v_seq, trim(v_req->>'description'), p_receptionist_id,
        NULLIF(v_req->>'assigned_to', '')::UUID,
        CASE WHEN NULLIF(v_req->>'assigned_to', '') IS NOT NULL THEN 'assigned' ELSE NULL END
      );
      v_seq := v_seq + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
END;
$func$;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_b_money_rpc_authz.sql') ON CONFLICT DO NOTHING;
