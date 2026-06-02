/* ============================================================
   配件表增加 17VIN 品牌分组ID 字段
   用于调用 40031 接口获取配件适配车型
   ============================================================ */

ALTER TABLE parts ADD COLUMN IF NOT EXISTS vin17_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_parts_vin17_group_id ON parts(vin17_group_id);
