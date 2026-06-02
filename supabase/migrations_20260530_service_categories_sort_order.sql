/* 维修项目分类增加排序字段 */
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

/* 为已存在的数据填充排序（按 created_at 递增） */
UPDATE service_categories t
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM service_categories
) sub
WHERE t.id = sub.id;

UPDATE service_categories
SET sort_order = 0
WHERE sort_order IS NULL;

/* 增加排序查询索引 */
CREATE INDEX IF NOT EXISTS idx_service_categories_sort_order
  ON service_categories(sort_order);
