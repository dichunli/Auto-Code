-- 工单类型：支持预约单、报价单、正常工单、保养工单、作废工单
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'normal'
  CHECK (order_type IN ('normal', 'appointment', 'quote', 'maintenance', 'cancelled'));

-- 作废原因
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- 预约相关字段
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS appointment_phone TEXT;

-- 索引
CREATE INDEX IF NOT EXISTS idx_work_orders_order_type ON work_orders(order_type);
CREATE INDEX IF NOT EXISTS idx_work_orders_status_type ON work_orders(status, order_type);
