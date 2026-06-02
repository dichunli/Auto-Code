/* ============================================================
   培训课程 - 支持引用知识库文章
   ============================================================ */

ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS knowledge_article_id UUID REFERENCES knowledge_articles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_training_courses_knowledge_article ON training_courses(knowledge_article_id);
