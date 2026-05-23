/* 加固 work_orders.mileage_in 字段，防止新建工单时传入 null 导致 NOT NULL 约束报错 */

ALTER TABLE work_orders ALTER COLUMN mileage_in SET DEFAULT 0;

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
AS $$
DECLARE
  v_order_id UUID;
  v_req JSONB;
  v_seq INTEGER := 1;
BEGIN
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
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
