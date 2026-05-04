-- 维修项目增加默认单位价
ALTER TABLE service_items ADD COLUMN IF NOT EXISTS company_price DECIMAL(10,2);
