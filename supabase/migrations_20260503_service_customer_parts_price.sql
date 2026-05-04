-- 为维修项目增加自带配件价字段
ALTER TABLE service_items ADD COLUMN IF NOT EXISTS customer_parts_price DECIMAL(10,2);
