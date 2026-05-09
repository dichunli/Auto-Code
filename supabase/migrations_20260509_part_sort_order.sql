-- 为配件分支增加排序字段（按项目分组）
ALTER TABLE work_order_item_parts ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 为已存在的数据填充排序（按 created_at 递增）
UPDATE work_order_item_parts t
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY work_order_item_id ORDER BY created_at ASC) AS rn
  FROM work_order_item_parts
) sub
WHERE t.id = sub.id;

UPDATE work_order_item_parts
SET sort_order = 0
WHERE sort_order IS NULL;

-- 增加排序查询的索引
CREATE INDEX IF NOT EXISTS idx_work_order_item_parts_item_sort
  ON work_order_item_parts(work_order_item_id, sort_order);
