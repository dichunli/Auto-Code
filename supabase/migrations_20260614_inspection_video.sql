/*
 * 为车况检查增加视频支持
 * 在 work_order_inspection_media 表的 media_type 中新增 inspection_video 类型
 */

/* 先删除旧约束（如果存在） */
ALTER TABLE work_order_inspection_media
DROP CONSTRAINT IF EXISTS work_order_inspection_media_media_type_check;

/* 添加新约束，增加 inspection_video 类型 */
ALTER TABLE work_order_inspection_media
ADD CONSTRAINT work_order_inspection_media_media_type_check
CHECK (media_type IN ('engine_oil_before', 'engine_oil_after', 'fluid', 'exterior', 'dashboard', 'reception_video', 'drive_belt', 'tire', 'inspection_video'));
