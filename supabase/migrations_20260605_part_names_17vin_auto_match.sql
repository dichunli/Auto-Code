/* ============================================================
   配件名称库和配件分类增加 17VIN 自动匹配车型开关
   ============================================================ */

ALTER TABLE part_categories
  ADD COLUMN IF NOT EXISTS auto_match_17vin_models BOOLEAN DEFAULT FALSE;

ALTER TABLE part_names
  ADD COLUMN IF NOT EXISTS auto_match_17vin_models BOOLEAN DEFAULT FALSE;
