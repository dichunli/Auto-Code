-- ============================================================
-- 客户预约系统
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  plate_number TEXT,
  vehicle_brand TEXT,
  vehicle_model TEXT,
  appointment_date DATE NOT NULL,
  appointment_time TEXT,
  service_type TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','arrived','cancelled','no_show')),
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_work_order ON appointments(work_order_id);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON appointments FOR ALL TO authenticated USING (true) WITH CHECK (true);
