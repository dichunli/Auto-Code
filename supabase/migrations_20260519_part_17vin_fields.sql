/* 配件信息表完善 — 为对接17VIN EPC数据做准备 */

/* ========== 1. 配件表增加OE号及EPC相关字段 ========== */
ALTER TABLE parts ADD COLUMN IF NOT EXISTS oe_number TEXT;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS oe_numbers TEXT[] DEFAULT '{}';
ALTER TABLE parts ADD COLUMN IF NOT EXISTS epc_source TEXT DEFAULT 'manual'
  CHECK (epc_source IN ('manual', '17vin'));
ALTER TABLE parts ADD COLUMN IF NOT EXISTS vin17_part_id TEXT;

/* ========== 2. 配件-车型适配关系表增强 ========== */
ALTER TABLE part_vehicle_models
  ADD COLUMN IF NOT EXISTS fitment_position TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
    CHECK (source IN ('manual', '17vin')),
  ADD COLUMN IF NOT EXISTS vin17_fitness_id TEXT;

/* ========== 3. 索引 ========== */
CREATE INDEX IF NOT EXISTS idx_parts_oe_number ON parts(oe_number);
CREATE INDEX IF NOT EXISTS idx_parts_vin17_part_id ON parts(vin17_part_id);
CREATE INDEX IF NOT EXISTS idx_part_vehicle_models_source ON part_vehicle_models(source);
