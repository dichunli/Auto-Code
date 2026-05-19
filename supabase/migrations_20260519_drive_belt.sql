/* 2026-05-19 车况检查增加传动皮带字段和媒体类型 */

ALTER TABLE work_order_inspections
  ADD COLUMN drive_belt_status TEXT CHECK (drive_belt_status IN ('good', 'fair', 'replace'));

COMMENT ON COLUMN work_order_inspections.drive_belt_status IS '传动皮带状态: good良好/fair一般/replace需更换';

/* 扩展媒体类型枚举，增加 drive_belt */
DO $$
BEGIN
  ALTER TABLE work_order_inspection_media
    DROP CONSTRAINT work_order_inspection_media_media_type_check;
EXCEPTION WHEN others THEN
  NULL;
END $$;

ALTER TABLE work_order_inspection_media
  ADD CONSTRAINT work_order_inspection_media_media_type_check
  CHECK (media_type IN ('engine_oil_before', 'engine_oil_after', 'fluid', 'exterior', 'dashboard', 'reception_video', 'drive_belt'));
