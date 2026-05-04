-- 车型定价扩展：增加 VIP价 和 自带配件价
ALTER TABLE service_item_prices ADD COLUMN IF NOT EXISTS vip_price DECIMAL(10,2);
ALTER TABLE service_item_prices ADD COLUMN IF NOT EXISTS customer_parts_price DECIMAL(10,2);

-- 单位定价扩展：增加车型关联，支持车型级单位价
ALTER TABLE company_service_prices ADD COLUMN IF NOT EXISTS vehicle_model_id INTEGER REFERENCES vehicle_models(id);
CREATE INDEX IF NOT EXISTS idx_csp_vehicle ON company_service_prices(vehicle_model_id);
