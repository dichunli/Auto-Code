/* 2026-05-19 车况检查最终清理 — 只添加确实不存在的字段 */

ALTER TABLE work_order_inspections
  ADD COLUMN IF NOT EXISTS engine_oil_before_level INTEGER,
  ADD COLUMN IF NOT EXISTS engine_oil_after_level INTEGER,
  ADD COLUMN IF NOT EXISTS coolant_ph DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS brake_fluid_water DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS battery_health INTEGER,
  ADD COLUMN IF NOT EXISTS battery_voltage DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS drive_belt_status TEXT,
  ADD COLUMN IF NOT EXISTS tire_checks JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS inspection_mileage DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS submitter_id UUID,
  ADD COLUMN IF NOT EXISTS inspectors JSONB DEFAULT '{}';

/* 更新媒体类型 CHECK 约束（无条件重建，确保包含所有类型） */
DO $$
BEGIN
  ALTER TABLE work_order_inspection_media
    DROP CONSTRAINT IF EXISTS work_order_inspection_media_media_type_check;
END $$;

ALTER TABLE work_order_inspection_media
  ADD CONSTRAINT work_order_inspection_media_media_type_check
  CHECK (media_type IN ('engine_oil_before', 'engine_oil_after', 'fluid', 'exterior', 'dashboard', 'reception_video', 'drive_belt', 'tire'));
