-- 为 vehicles 表添加底盘型号和变速箱型号字段
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassis_code TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission_code TEXT;
