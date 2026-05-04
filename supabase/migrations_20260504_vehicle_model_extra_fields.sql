-- 车型库增加发动机型号、底盘型号、变速箱型号（如果不存在）
ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS 发动机型号 TEXT;
ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS 底盘型号 TEXT;
ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS 变速箱型号 TEXT;
