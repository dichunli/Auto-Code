-- 配件单据名称（采购单上的配件名称）
ALTER TABLE parts ADD COLUMN IF NOT EXISTS document_name TEXT;
CREATE INDEX IF NOT EXISTS idx_parts_document_name ON parts(document_name);
