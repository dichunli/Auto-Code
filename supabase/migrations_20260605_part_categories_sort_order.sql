/* ============================================================
   配件分类增加排序字段
   ============================================================ */

/* 1. 添加 sort_order 字段 */
ALTER TABLE part_categories
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

/* 2. 为现有数据设置默认排序（按 created_at 倒序） */
UPDATE part_categories
SET sort_order = sub.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS row_num
  FROM part_categories
) sub
WHERE part_categories.id = sub.id;

/* 3. 添加索引 */
CREATE INDEX IF NOT EXISTS idx_part_categories_sort_order
  ON part_categories(sort_order);
