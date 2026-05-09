-- 为工单配件分支添加成本价字段（含均摊运费）
ALTER TABLE work_order_item_parts ADD COLUMN cost_price DECIMAL(10,2);
