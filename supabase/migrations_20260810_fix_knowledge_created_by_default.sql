/* ============================================================
   修复知识库新建文章 403 的问题
   背景：20260608_fix_null_owner.sql 写了但一直没在数据库执行，
   导致 created_by 为空的 INSERT 被 knowledge_owner_manage 策略拦截。
   本迁移做两件事：
   1. created_by 加默认值 auth.uid()，新文章自动记录作者
   2. owner 策略补上过期的 NULL 兼容（旧文章没作者的也能被编辑）
   ============================================================ */

/* 1. created_by 加默认值：插入时不传也自动填当前用户 */
ALTER TABLE knowledge_articles
  ALTER COLUMN created_by SET DEFAULT auth.uid();

/* 2. 重建 owner 策略（与 20260608_fix_null_owner.sql 一致） */
DROP POLICY IF EXISTS "knowledge_owner_manage" ON knowledge_articles;

CREATE POLICY "knowledge_owner_manage" ON knowledge_articles
  FOR ALL TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);
