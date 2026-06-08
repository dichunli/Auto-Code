/* ============================================================
   修复 knowledge_owner_manage 的 WITH CHECK 不允许 created_by 为 NULL
   ============================================================ */

DROP POLICY IF EXISTS "knowledge_owner_manage" ON knowledge_articles;

CREATE POLICY "knowledge_owner_manage" ON knowledge_articles
  FOR ALL TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);
