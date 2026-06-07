/* ============================================================
   知识库文章按岗位控制阅读权限
   ============================================================ */

/* 1. 扩展 visibility 字段，增加 "role" 选项 */
ALTER TABLE knowledge_articles
  DROP CONSTRAINT IF EXISTS knowledge_articles_visibility_check;

ALTER TABLE knowledge_articles
  ADD CONSTRAINT knowledge_articles_visibility_check
  CHECK (visibility IN ('public', 'internal', 'private', 'role'));

/* 2. 创建文章与角色的关联表 */
CREATE TABLE IF NOT EXISTS knowledge_article_roles (
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (article_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_article_roles_article
  ON knowledge_article_roles(article_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_article_roles_role
  ON knowledge_article_roles(role_name);

ALTER TABLE knowledge_article_roles ENABLE ROW LEVEL SECURITY;

/* 3. 角色关联表的 RLS 策略 */
/* 管理员拥有所有权限 */
CREATE POLICY "knowledge_article_roles_admin" ON knowledge_article_roles
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

/* 文章作者可以管理自己文章的角色关联 */
CREATE POLICY "knowledge_article_roles_owner" ON knowledge_article_roles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM knowledge_articles ka
      WHERE ka.id = knowledge_article_roles.article_id AND ka.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM knowledge_articles ka
      WHERE ka.id = knowledge_article_roles.article_id AND ka.created_by = auth.uid()
    )
  );

/* 4. 新增按角色阅读的文章查询策略 */
/* 当 visibility = 'role' 时，只有关联角色中的用户才能查看 */
CREATE POLICY "knowledge_role_read" ON knowledge_articles
  FOR SELECT TO authenticated
  USING (
    visibility = 'role' AND
    EXISTS (
      SELECT 1 FROM knowledge_article_roles kar
      WHERE kar.article_id = knowledge_articles.id
        AND kar.role_name IN (
          SELECT r.name FROM roles r
          JOIN profile_roles pr ON r.id = pr.role_id
          WHERE pr.profile_id = auth.uid()
        )
    )
  );
