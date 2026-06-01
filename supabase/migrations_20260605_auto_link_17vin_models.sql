/* ============================================================
   修改触发器 auto_link_part_to_vehicle，支持17VIN车型自动关联
   ============================================================ */

/* 重要：此处 p.part_category_id 已修正为 pn.category_id
   原因：parts 表实际列名为 category_id，不是 part_category_id
   后续若修改此触发器，请勿恢复为 p.part_category_id */

CREATE OR REPLACE FUNCTION auto_link_part_to_vehicle()
RETURNS TRIGGER AS $BODY$
DECLARE
  v_vehicle_model_id INTEGER;
  v_auto_link BOOLEAN;
  v_should_match_17vin BOOLEAN;
BEGIN
  /* 1. 获取当前工单的车型 */
  SELECT v.vehicle_model_id INTO v_vehicle_model_id
  FROM work_orders wo
  JOIN vehicles v ON v.id = wo.vehicle_id
  JOIN work_order_items woi ON woi.work_order_id = wo.id
  WHERE woi.id = NEW.work_order_item_id;

  /* 2. 获取配件分类的 auto_link_vehicle_model 设置 */
  SELECT pc.auto_link_vehicle_model INTO v_auto_link
  FROM parts p
  JOIN part_names pn ON pn.id = p.part_name_id
  JOIN part_categories pc ON pc.id = pn.category_id
  WHERE p.id = NEW.part_id;

  /* 3. 关联当前车型 */
  IF v_auto_link AND v_vehicle_model_id IS NOT NULL THEN
    INSERT INTO part_vehicle_models (part_id, vehicle_model_id)
    VALUES (NEW.part_id, v_vehicle_model_id)
    ON CONFLICT (part_id, vehicle_model_id) DO NOTHING;
  END IF;

  /* 4. 检查配件分类或名称是否标记了17VIN自动匹配 */
  SELECT COALESCE(pc.auto_match_17vin_models, pn.auto_match_17vin_models, FALSE)
  INTO v_should_match_17vin
  FROM parts p
  LEFT JOIN part_categories pc ON pc.id = p.category_id
  LEFT JOIN part_names pn ON pn.id = p.part_name_id
  WHERE p.id = NEW.part_id;

  /* 5. 如果标记了17VIN自动匹配，关联该配件在17VIN中预存的所有适配车型 */
  IF v_should_match_17vin THEN
    INSERT INTO part_vehicle_models (part_id, vehicle_model_id, source, vin17_fitness_id)
    SELECT NEW.part_id, pvm.vehicle_model_id, '17vin', pvm.vin17_fitness_id
    FROM part_vehicle_models pvm
    WHERE pvm.part_id = NEW.part_id
      AND pvm.source = '17vin'
      AND pvm.vehicle_model_id IS NOT NULL
    ON CONFLICT (part_id, vehicle_model_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;
