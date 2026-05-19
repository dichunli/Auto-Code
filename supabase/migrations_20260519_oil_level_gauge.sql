/* 2026-05-19 车况检查机油油位标尺字段 */

ALTER TABLE work_order_inspections
  ADD COLUMN engine_oil_before_level INTEGER,
  ADD COLUMN engine_oil_after_level INTEGER;

COMMENT ON COLUMN work_order_inspections.engine_oil_before_level IS '机油油位-施工前，0-100整数';
COMMENT ON COLUMN work_order_inspections.engine_oil_after_level IS '机油油位-施工后，0-100整数';
