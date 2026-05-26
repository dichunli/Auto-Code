/* 给 work_orders 表添加仪表照片和排异标照片字段 */
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS dashboard_photos TEXT[] DEFAULT '{}';
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS rejection_mark_photos TEXT[] DEFAULT '{}';
