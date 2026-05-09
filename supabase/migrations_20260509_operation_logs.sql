-- 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  user_name TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'login', 'logout',
    'work_order_create', 'work_order_update', 'work_order_delete',
    'work_order_status_change', 'work_order_assign', 'work_order_settle',
    'work_order_convert',
    'customer_create', 'customer_update', 'customer_delete',
    'vehicle_create', 'vehicle_update', 'vehicle_delete',
    'part_in', 'part_out', 'part_adjust',
    'payment_create', 'payment_refund',
    'purchase_order_create', 'purchase_order_update', 'purchase_order_arrive',
    'construction_start', 'construction_pause', 'construction_complete',
    'quality_check', 'follow_up_create',
    'inventory_check', 'finance_transaction'
  )),
  target_table TEXT,
  target_id UUID,
  target_name TEXT,
  old_values JSONB,
  new_values JSONB,
  description TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_operation_logs_user_id ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_action_type ON operation_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_operation_logs_target ON operation_logs(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at DESC);

-- RLS
ALTER TABLE operation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all read" ON operation_logs;
CREATE POLICY "Allow all read" ON operation_logs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all insert" ON operation_logs;
CREATE POLICY "Allow all insert" ON operation_logs
  FOR INSERT WITH CHECK (true);
