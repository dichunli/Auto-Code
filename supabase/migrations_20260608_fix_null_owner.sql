/* ============================================================
   修复 created_by 为 NULL 的文章无法编辑的问题
   ============================================================ */

/* 删除旧的 owner 策略 */
DROP POLICY IF EXISTS "knowledge_owner_manage" ON knowledge_articles;

/* 创建新的 owner 策略：允许作者编辑，也允许 created_by 为 NULL 的文章被编辑 */
CREATE POLICY "knowledge_owner_manage" ON knowledge_articles
  FOR ALL TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);
