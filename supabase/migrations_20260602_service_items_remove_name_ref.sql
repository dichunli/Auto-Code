/* ============================================================
   维修项目去名称库化改造
   ============================================================ */

/* 1. 删除 service_name_id 外键约束 */
ALTER TABLE service_items
  DROP CONSTRAINT IF EXISTS service_items_service_name_id_fkey;

/* 2. 删除 service_name_id 列 */
ALTER TABLE service_items
  DROP COLUMN IF EXISTS service_name_id;

/* 3. 增加 search_keywords 搜索关键字字段 */
ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS search_keywords TEXT;

/* 4. 删除基于 service_name_id 的旧索引 */
DROP INDEX IF EXISTS idx_service_items_name;

/* 5. 添加 name + search_keywords 搜索索引 */
CREATE INDEX IF NOT EXISTS idx_service_items_search
  ON service_items USING gin(
    to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(search_keywords, ''))
  );

/* 6. 删除自动填入名称的触发器 */
DROP TRIGGER IF EXISTS fill_service_item_name ON service_items;

/* 7. 删除触发器函数 */
DROP FUNCTION IF EXISTS auto_fill_service_item_name();
