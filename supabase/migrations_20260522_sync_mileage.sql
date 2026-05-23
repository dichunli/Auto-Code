/* ============================================================
   里程同步触发器：工单里程、接车检查里程、车况检查里程始终保持一致
   ============================================================ */

/* 1. 工单里程变化时，同步到所有检查记录 */
CREATE OR REPLACE FUNCTION sync_mileage_from_work_order()
RETURNS TRIGGER AS $$
BEGIN
  /* 防止循环触发 */
  IF pg_trigger_depth() > 0 THEN
    RETURN NEW;
  END IF;

  UPDATE work_order_inspections
  SET inspection_mileage = NEW.mileage_in
  WHERE work_order_id = NEW.id
    AND inspection_mileage IS DISTINCT FROM NEW.mileage_in;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_mileage_from_work_order ON work_orders;
CREATE TRIGGER trg_sync_mileage_from_work_order
AFTER UPDATE OF mileage_in ON work_orders
FOR EACH ROW
WHEN (OLD.mileage_in IS DISTINCT FROM NEW.mileage_in)
EXECUTE FUNCTION sync_mileage_from_work_order();

/* 2. 检查记录里程变化时，同步到工单表和其他检查记录 */
CREATE OR REPLACE FUNCTION sync_mileage_from_inspection()
RETURNS TRIGGER AS $$
BEGIN
  /* 防止循环触发 */
  IF pg_trigger_depth() > 0 THEN
    RETURN NEW;
  END IF;

  /* 同步到工单表 */
  UPDATE work_orders
  SET mileage_in = NEW.inspection_mileage
  WHERE id = NEW.work_order_id
    AND mileage_in IS DISTINCT FROM NEW.inspection_mileage;

  /* 同步到同一工单下的其他检查记录 */
  UPDATE work_order_inspections
  SET inspection_mileage = NEW.inspection_mileage
  WHERE work_order_id = NEW.work_order_id
    AND id <> NEW.id
    AND inspection_mileage IS DISTINCT FROM NEW.inspection_mileage;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_mileage_from_inspection ON work_order_inspections;
CREATE TRIGGER trg_sync_mileage_from_inspection
AFTER INSERT OR UPDATE OF inspection_mileage ON work_order_inspections
FOR EACH ROW
WHEN (NEW.inspection_mileage IS NOT NULL)
EXECUTE FUNCTION sync_mileage_from_inspection();
