-- 添加工单整单折扣字段
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_rate DECIMAL(10,8) DEFAULT 1;
