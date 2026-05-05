-- 配件互换码
ALTER TABLE parts ADD COLUMN IF NOT EXISTS interchange_code TEXT;
CREATE INDEX IF NOT EXISTS idx_parts_interchange ON parts(interchange_code);
