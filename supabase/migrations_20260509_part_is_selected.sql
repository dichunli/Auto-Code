-- 为工单配件分支添加选中状态字段
ALTER TABLE work_order_item_parts ADD COLUMN is_selected BOOLEAN DEFAULT FALSE;
