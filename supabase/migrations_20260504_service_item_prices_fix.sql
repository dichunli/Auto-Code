-- 修复 service_item_prices 表：vehicle_model_id 改为 INTEGER 并补充 company_price
-- 由于旧表 vehicle_model_id 是 UUID，与实际的 vehicle_models.id (INTEGER) 完全不匹配，
-- 直接重建表（旧数据中的 UUID 外键已无效）

-- 1) 先备份旧表（以防万一）
DROP TABLE IF EXISTS service_item_prices_backup;
ALTER TABLE service_item_prices RENAME TO service_item_prices_backup;

-- 2) 重建正确结构的表
CREATE TABLE service_item_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id UUID NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
  vehicle_model_id INTEGER REFERENCES vehicle_models(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  vip_price DECIMAL(10,2),
  customer_parts_price DECIMAL(10,2),
  company_price DECIMAL(10,2),
  UNIQUE(service_item_id, vehicle_model_id)
);

-- 3) 添加索引（旧索引可能仍存在，先删除）
DROP INDEX IF EXISTS idx_service_item_prices;
CREATE INDEX idx_service_item_prices ON service_item_prices(service_item_id, vehicle_model_id);

-- 4) RLS
ALTER TABLE service_item_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON service_item_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5) 清理备份（确认无误后可手动删除）
-- DROP TABLE IF EXISTS service_item_prices_backup;
