/* 2026-05-19 车况检查增加防冻液/刹车油/蓄电池/尾气字段 */

ALTER TABLE work_order_inspections
  ADD COLUMN coolant_ph DECIMAL(4,2),
  ADD COLUMN brake_fluid_water DECIMAL(5,2),
  ADD COLUMN battery_health INTEGER,
  ADD COLUMN battery_voltage DECIMAL(4,2);

COMMENT ON COLUMN work_order_inspections.coolant_ph IS '防冻液PH值';
COMMENT ON COLUMN work_order_inspections.brake_fluid_water IS '刹车油含水量(%)';
COMMENT ON COLUMN work_order_inspections.battery_health IS '蓄电池寿命(%)';
COMMENT ON COLUMN work_order_inspections.battery_voltage IS '蓄电池电压(V)';
