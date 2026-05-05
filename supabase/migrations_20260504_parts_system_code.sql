-- 配件系统码 + 多规格支持

-- 1) 配件实例增加系统码（唯一、永久不变）
ALTER TABLE parts ADD COLUMN IF NOT EXISTS system_code TEXT UNIQUE;

-- 2) 配件与规格多对多关联（支持一个配件多个规格）
CREATE TABLE IF NOT EXISTS parts_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  specification_id UUID NOT NULL REFERENCES part_specifications(id) ON DELETE CASCADE,
  UNIQUE(part_id, specification_id)
);
CREATE INDEX IF NOT EXISTS idx_ps_part ON parts_specifications(part_id);
CREATE INDEX IF NOT EXISTS idx_ps_spec ON parts_specifications(specification_id);
