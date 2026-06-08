/* ============================================================
   允许所有认证用户查看阅读记录（用于显示阅读次数）
   ============================================================ */

DROP POLICY IF EXISTS "knowledge_article_reads_own" ON knowledge_article_reads;

CREATE POLICY "knowledge_article_reads_select_all" ON knowledge_article_reads
  FOR SELECT TO authenticated
  USING (true);
