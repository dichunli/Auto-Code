/* ============================================================
   培训晋级 - 课程分类管理
   1. 新建 training_categories 课程分类表
   2. 为 training_courses 增加 category_id 外键
   3. 将原有 category 字段值迁移到 category_id
   ============================================================ */

/* -----------------------------------------------------------
   1. 课程分类表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS training_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_training_categories_sort_order
  ON training_categories(sort_order);

/* -----------------------------------------------------------
   2. RLS 策略
   ----------------------------------------------------------- */
ALTER TABLE training_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON training_categories;
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

/* -----------------------------------------------------------
   3. 初始化默认分类
   ----------------------------------------------------------- */
INSERT INTO training_categories (name, code, sort_order, is_active)
VALUES
  ('安全', 'safety', 0, TRUE),
  ('技术', 'technical', 1, TRUE),
  ('服务', 'service', 2, TRUE),
  ('管理', 'management', 3, TRUE)
ON CONFLICT (name) DO NOTHING;

/* -----------------------------------------------------------
   4. 为 training_courses 增加 category_id 外键
   ----------------------------------------------------------- */
ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES training_categories(id) ON DELETE SET NULL;

/* -----------------------------------------------------------
   5. 将已有 category 字段值迁移到 category_id
      保留原 category 字段作为备份，后续稳定后再移除
   ----------------------------------------------------------- */
UPDATE training_courses
SET category_id = tc.id
FROM training_categories tc
WHERE training_courses.category = tc.code;

/* 对于未匹配上的记录，默认归到"技术"分类 */
UPDATE training_courses
SET category_id = (SELECT id FROM training_categories WHERE code = 'technical' LIMIT 1)
WHERE category_id IS NULL AND category IS NOT NULL;
