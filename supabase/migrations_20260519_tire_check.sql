/* 2026-05-19 车况检查增加轮胎检查字段和媒体类型 */

ALTER TABLE work_order_inspections
  ADD COLUMN tire_checks JSONB DEFAULT '{}';

COMMENT ON COLUMN work_order_inspections.tire_checks IS '轮胎检查状态 JSON: {fl,fr,rl,rr} 值为 good/fair/replace';

/* 扩展媒体类型枚举，增加 tire */
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
