-- 配件分支数量允许为空（未填写时不默认填1）
ALTER TABLE work_order_item_parts ALTER COLUMN quantity DROP NOT NULL;
ALTER TABLE work_order_item_parts ALTER COLUMN quantity DROP DEFAULT;

-- 保持现有数据不变（已有数据的 quantity 仍为当前值）
-- 新添加的配件不填数量时默认为 null
