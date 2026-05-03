-- 客户性别/称谓字段
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender TEXT;
