/* ============================================================
   修复知识库文章作者无法编辑自己文章的问题
   ============================================================ */

/* 文章作者可以更新自己的文章 */
CREATE POLICY "knowledge_articles_owner_update" ON knowledge_articles
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

/* admin 可以更新所有文章 */
CREATE POLICY "knowledge_articles_admin_update" ON knowledge_articles
  FOR UPDATE TO authenticated
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
