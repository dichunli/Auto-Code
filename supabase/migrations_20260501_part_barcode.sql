-- ============================================================
-- 配件条形码
-- ============================================================

ALTER TABLE parts ADD COLUMN IF NOT EXISTS barcode TEXT;

COMMENT ON COLUMN parts.barcode IS '配件条形码（如与 part_number 不同则单独填写）';

CREATE INDEX IF NOT EXISTS idx_parts_barcode ON parts(barcode);
