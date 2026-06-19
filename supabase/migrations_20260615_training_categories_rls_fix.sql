/* ============================================================
   修复 training_categories 的 RLS 策略
   ============================================================ */

/* 先禁用再重新启用 RLS，确保策略重新加载 */
ALTER TABLE training_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE training_categories ENABLE ROW LEVEL SECURITY;

/* 删除旧策略（如果存在） */
DROP POLICY IF EXISTS "auth_full_access" ON training_categories;

/* 分别创建增删改查策略，比 FOR ALL 更明确 */
DROP POLICY IF EXISTS "training_categories_select" ON training_categories;
DROP POLICY IF EXISTS "training_categories_insert" ON training_categories;
DROP POLICY IF EXISTS "training_categories_update" ON training_categories;
DROP POLICY IF EXISTS "training_categories_delete" ON training_categories;

CREATE POLICY "training_categories_select" ON training_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "training_categories_insert" ON training_categories
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "training_categories_update" ON training_categories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "training_categories_delete" ON training_categories
  FOR DELETE TO authenticated USING (true);
