-- 维修项目 commission 体系升级

-- 1) service_names 增加 commission 覆盖字段（同 part_names）
ALTER TABLE service_names
  ADD COLUMN IF NOT EXISTS sales_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS sales_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS diagnosis_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS repair_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS repair_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS qc_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS qc_commission_value DECIMAL(10,2);

-- 2) service_items 增加 commission 覆盖字段（同 parts）
ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS sales_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS sales_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS diagnosis_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS repair_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS repair_commission_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS qc_commission_type TEXT,
  ADD COLUMN IF NOT EXISTS qc_commission_value DECIMAL(10,2);

-- 3) part_names 增加默认数量
ALTER TABLE part_names ADD COLUMN IF NOT EXISTS default_quantity INTEGER DEFAULT 1;

-- 4) 维修项目名称与配件名称关联表
CREATE TABLE IF NOT EXISTS service_name_part_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name_id UUID NOT NULL REFERENCES service_names(id) ON DELETE CASCADE,
  part_name_id UUID NOT NULL REFERENCES part_names(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  UNIQUE(service_name_id, part_name_id)
);

CREATE INDEX IF NOT EXISTS idx_snpn_service ON service_name_part_names(service_name_id);
CREATE INDEX IF NOT EXISTS idx_snpn_part ON service_name_part_names(part_name_id);
