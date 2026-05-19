/* 2026-05-19 车况检查增加顶部信息栏字段和各部分检查人 */

ALTER TABLE work_order_inspections
  ADD COLUMN inspection_mileage DECIMAL(10,2),
  ADD COLUMN submitter_id UUID,
  ADD COLUMN inspectors JSONB DEFAULT '{}';

COMMENT ON COLUMN work_order_inspections.inspection_mileage IS '检查里程(km)';
COMMENT ON COLUMN work_order_inspections.submitter_id IS '总提交人ID';
COMMENT ON COLUMN work_order_inspections.inspectors IS '各部分检查人 JSON: {oil, dashboard, light, brake, exhaust, fluid, belt, battery, tire} 值为 profile id';
