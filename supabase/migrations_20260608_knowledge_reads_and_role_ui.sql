/* ============================================================
   知识库阅读记录表 + 岗位权限功能补充
   ============================================================ */

/* 1. 创建阅读记录表 */
CREATE TABLE IF NOT EXISTS knowledge_article_reads (
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  read_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (article_id, user_id, read_date)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_article_reads_article
  ON knowledge_article_reads(article_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_article_reads_user
  ON knowledge_article_reads(user_id);

/* 阅读记录表RLS：管理员可以查看所有，普通用户只能看到自己的 */
ALTER TABLE knowledge_article_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_article_reads_admin" ON knowledge_article_reads
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profile_roles pr
      JOIN roles r ON pr.role_id = r.id
      WHERE pr.profile_id = auth.uid() AND r.name = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profile_roles pr
      JOIN roles r ON pr.role_id = r.id
      WHERE pr.profile_id = auth.uid() AND r.name = 'admin'
    )
  );

CREATE POLICY "knowledge_article_reads_own" ON knowledge_article_reads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

/* 2. 允许用户插入自己的阅读记录 */
CREATE POLICY "knowledge_article_reads_insert" ON knowledge_article_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
