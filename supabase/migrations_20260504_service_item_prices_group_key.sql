-- 车型定价支持分组持久化
ALTER TABLE service_item_prices ADD COLUMN IF NOT EXISTS group_key TEXT;
