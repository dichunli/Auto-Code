-- 预收款记录表
CREATE TABLE IF NOT EXISTS advance_payment_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','wechat','alipay','bank_transfer')),
  collector_id UUID REFERENCES profiles(id),
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_advance_payment_records_work_order_id
  ON advance_payment_records(work_order_id);
CREATE INDEX IF NOT EXISTS idx_advance_payment_records_paid_at
  ON advance_payment_records(paid_at);

-- RLS
ALTER TABLE advance_payment_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON advance_payment_records
  FOR ALL USING (true) WITH CHECK (true);
