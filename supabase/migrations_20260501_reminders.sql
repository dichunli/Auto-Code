-- ============================================================
-- 保养提醒与客户通知系统
-- ============================================================

-- 客户生日字段
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday DATE;

-- 保养提醒
CREATE TABLE IF NOT EXISTS maintenance_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('time','mileage')),
  title TEXT NOT NULL,
  due_date DATE,
  due_mileage INTEGER,
  current_mileage INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','notified','completed','cancelled')),
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_reminders_status ON maintenance_reminders(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_reminders_due_date ON maintenance_reminders(due_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_reminders_vehicle ON maintenance_reminders(vehicle_id);

ALTER TABLE maintenance_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON maintenance_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 通知记录
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('work_order_status','maintenance_due','birthday','marketing','appointment')),
  title TEXT NOT NULL,
  content TEXT,
  channel TEXT CHECK (channel IN ('sms','wechat','app','phone')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','read')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  related_type TEXT,
  related_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_at);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_full_access" ON notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
