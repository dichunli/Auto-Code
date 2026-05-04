-- 客户联系人表：一个客户可关联多个联系人
CREATE TABLE IF NOT EXISTS customer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relationship TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_customer ON customer_contacts(customer_id);

-- RLS
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON customer_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
