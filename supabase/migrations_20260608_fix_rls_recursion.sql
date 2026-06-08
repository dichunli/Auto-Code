/* ============================================================
   修复知识库 RLS 策略无限递归问题
   ============================================================ */

/* 1. 删除导致循环的策略 */
DROP POLICY IF EXISTS "knowledge_article_roles_owner" ON knowledge_article_roles;

/* 2. 给 knowledge_article_roles 表添加简单的 SELECT 策略
   所有认证用户都可以读取关联数据（真正的权限控制由 knowledge_articles 表的 RLS 完成） */
CREATE POLICY "knowledge_article_roles_select" ON knowledge_article_roles
  FOR SELECT TO authenticated
  USING (true);

/* 3. 检查并修复 knowledge_articles 表的 RLS 策略
   删除有问题的 role_read 策略，重新创建 */
DROP POLICY IF EXISTS "knowledge_role_read" ON knowledge_articles;

/* 新的 role_read 策略：直接通过 subquery 检查用户角色，不引用 knowledge_article_roles 表的 RLS */
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
