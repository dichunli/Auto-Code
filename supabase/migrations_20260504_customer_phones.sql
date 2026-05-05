-- 客户备用手机号表
CREATE TABLE IF NOT EXISTS customer_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cp_customer ON customer_phones(customer_id);
CREATE INDEX IF NOT EXISTS idx_cp_phone ON customer_phones(phone);

ALTER TABLE customer_phones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON customer_phones FOR ALL TO authenticated USING (true) WITH CHECK (true);
