-- 培训课程：无限分级 + 专题标签
-- 日期：2026-07-13

/* ========================================
   1. 分类支持无限层级（加 parent_id）
   ======================================== */
ALTER TABLE training_categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES training_categories(id) ON DELETE SET NULL;

/* 索引：加速查子分类 */
CREATE INDEX IF NOT EXISTS idx_training_categories_parent_id ON training_categories(parent_id);

/* ========================================
   2. 专题表（扁平标签，用于跨分类筛选课程）
   ======================================== */
CREATE TABLE IF NOT EXISTS training_topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

/* ========================================
   3. 课程-专题关联表（多对多）
   ======================================== */
CREATE TABLE IF NOT EXISTS training_course_topics (
  course_id UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES training_topics(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, topic_id)
);

/* 索引 */
CREATE INDEX IF NOT EXISTS idx_training_course_topics_course ON training_course_topics(course_id);
CREATE INDEX IF NOT EXISTS idx_training_course_topics_topic ON training_course_topics(topic_id);

/* ========================================
   4. RLS 策略
   ======================================== */
ALTER TABLE training_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_course_topics ENABLE ROW LEVEL SECURITY;

-- 专题：认证用户可读写
CREATE POLICY "认证用户可读写专题" ON training_topics
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- 课程-专题关联：认证用户可读写
CREATE POLICY "认证用户可读写课程专题关联" ON training_course_topics
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);