-- 为 work_order_items 表增加提交人和质检人字段
ALTER TABLE work_order_items
  ADD COLUMN IF NOT EXISTS submitter_id UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS inspector_id UUID REFERENCES profiles(id);
