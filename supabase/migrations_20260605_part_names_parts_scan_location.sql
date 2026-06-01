/* ============================================================
   part_names 和 parts 表增加扫码出库确认和入库仓位确认字段
   ============================================================ */

ALTER TABLE part_names
  ADD COLUMN IF NOT EXISTS require_scan_check BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS require_location_check BOOLEAN DEFAULT FALSE;

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS require_scan_check BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS require_location_check BOOLEAN DEFAULT FALSE;
