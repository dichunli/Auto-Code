-- 为维修项目增加排序字段（按需求分组）
ALTER TABLE work_order_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 为已存在的数据填充排序（按 created_at 递增）
UPDATE work_order_items t
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY requirement_id ORDER BY created_at ASC) AS rn
  FROM work_order_items
  WHERE requirement_id IS NOT NULL
) sub
WHERE t.id = sub.id;

UPDATE work_order_items
SET sort_order = 0
WHERE sort_order IS NULL;

-- 增加排序查询的索引
CREATE INDEX IF NOT EXISTS idx_work_order_items_requirement_sort
  ON work_order_items(requirement_id, sort_order);
