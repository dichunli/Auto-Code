-- 为 vehicles 表添加变速箱形式字段
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission_type TEXT;
