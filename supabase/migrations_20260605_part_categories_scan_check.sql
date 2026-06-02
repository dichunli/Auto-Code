/* ============================================================
   配件分类增加扫码出库确认 + 入库仓位确认选项
   ============================================================ */

/* 添加 require_scan_check 字段 */
ALTER TABLE part_categories
  ADD COLUMN IF NOT EXISTS require_scan_check BOOLEAN DEFAULT FALSE;

/* 添加 require_location_check 字段 */
ALTER TABLE part_categories
  ADD COLUMN IF NOT EXISTS require_location_check BOOLEAN DEFAULT FALSE;
