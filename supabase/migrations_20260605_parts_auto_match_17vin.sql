/* ============================================================
   配件表增加 17VIN 自动匹配车型开关字段
   ============================================================ */

ALTER TABLE parts ADD COLUMN IF NOT EXISTS auto_match_17vin_models BOOLEAN DEFAULT FALSE;
