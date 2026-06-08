/* ============================================================
   修复 knowledge_article_roles 表缺少 INSERT/DELETE RLS 策略
   ============================================================ */

/* 允许认证用户插入岗位关联（真正的权限控制由 knowledge_articles 的 RLS 完成） */
CREATE POLICY "knowledge_article_roles_insert" ON knowledge_article_roles
  FOR INSERT TO authenticated
  WITH CHECK (true);

/* 允许认证用户删除岗位关联 */
CREATE POLICY "knowledge_article_roles_delete" ON knowledge_article_roles
  FOR DELETE TO authenticated
  USING (true);
