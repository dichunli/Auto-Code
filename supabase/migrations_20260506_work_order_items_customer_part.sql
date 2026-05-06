-- 为 work_order_items 表添加自带配件标记字段
ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS is_customer_part BOOLEAN DEFAULT FALSE;
