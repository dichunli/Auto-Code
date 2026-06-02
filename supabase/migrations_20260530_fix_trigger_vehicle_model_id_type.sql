/* ============================================================
   修复触发器 auto_link_part_to_vehicle
   1. vehicle_model_id 改为 INTEGER 类型（同步 vehicles 表变更）
   2. 【重要】p.part_category_id 已修正为 pn.category_id
      原因：parts 表实际列名为 category_id，不是 part_category_id
      后续若修改此触发器，请勿恢复为 p.part_category_id
   ============================================================ */

CREATE OR REPLACE FUNCTION auto_link_part_to_vehicle()
RETURNS TRIGGER AS $BODY$
DECLARE
  v_vehicle_model_id INTEGER;
  v_auto_link BOOLEAN;
BEGIN
  SELECT v.vehicle_model_id INTO v_vehicle_model_id
  FROM work_orders wo
  JOIN vehicles v ON v.id = wo.vehicle_id
  JOIN work_order_items woi ON woi.work_order_id = wo.id
  WHERE woi.id = NEW.work_order_item_id;

  SELECT pc.auto_link_vehicle_model INTO v_auto_link
  FROM parts p
  JOIN part_names pn ON pn.id = p.part_name_id
  JOIN part_categories pc ON pc.id = pn.category_id
  WHERE p.id = NEW.part_id;

  IF v_auto_link AND v_vehicle_model_id IS NOT NULL THEN
    INSERT INTO part_vehicle_models (part_id, vehicle_model_id)
    VALUES (NEW.part_id, v_vehicle_model_id)
    ON CONFLICT (part_id, vehicle_model_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;
