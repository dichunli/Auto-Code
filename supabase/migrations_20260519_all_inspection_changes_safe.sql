/* 2026-05-19 车况检查全部字段安全合并迁移（已存在会自动跳过） */

/* 1. 机油油位标尺 */
ALTER TABLE work_order_inspections
  ADD COLUMN IF NOT EXISTS engine_oil_before_level INTEGER,
  ADD COLUMN IF NOT EXISTS engine_oil_after_level INTEGER;

/* 2. 防冻液/刹车油/蓄电池（已添加的会自动跳过） */
ALTER TABLE work_order_inspections
  ADD COLUMN IF NOT EXISTS coolant_ph DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS brake_fluid_water DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS battery_health INTEGER,
  ADD COLUMN IF NOT EXISTS battery_voltage DECIMAL(4,2);

/* 3. 传动皮带 */
ALTER TABLE work_order_inspections
  ADD COLUMN IF NOT EXISTS drive_belt_status TEXT;

/* 4. 轮胎检查 */
ALTER TABLE work_order_inspections
  ADD COLUMN IF NOT EXISTS tire_checks JSONB DEFAULT '{}';

/* 5. 顶部信息栏 */
ALTER TABLE work_order_inspections
  ADD COLUMN IF NOT EXISTS inspection_mileage DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS submitter_id UUID,
  ADD COLUMN IF NOT EXISTS inspectors JSONB DEFAULT '{}';

/* 扩展媒体类型 CHECK 约束 */
DO $$
BEGIN
  ALTER TABLE work_order_inspection_media
    DROP CONSTRAINT work_order_inspection_media_media_type_check;
EXCEPTION WHEN others THEN
  NULL;
END $$;

ALTER TABLE work_order_inspection_media
  ADD CONSTRAINT work_order_inspection_media_media_type_check
  CHECK (media_type IN ('engine_oil_before', 'engine_oil_after', 'fluid', 'exterior', 'dashboard', 'reception_video', 'drive_belt', 'tire'));
