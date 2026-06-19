/* ============================================================
 * 搜索分词词典表
 *
 * 允许管理员在后台维护自定义分词，
 * 知识库搜索分词器会合并默认词库 + 自定义词库。
 * ============================================================ */

CREATE TABLE IF NOT EXISTS search_dictionary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  word TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_search_dictionary_word
  ON search_dictionary(word);

CREATE INDEX IF NOT EXISTS idx_search_dictionary_created_at
  ON search_dictionary(created_at);

/* RLS：仅管理员可读写 */
ALTER TABLE search_dictionary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "search_dictionary_admin_all" ON search_dictionary;
CREATE POLICY "search_dictionary_admin_all" ON search_dictionary
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profile_roles pr
      JOIN roles r ON r.id = pr.role_id
      WHERE pr.profile_id = auth.uid() AND r.name = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profile_roles pr
      JOIN roles r ON r.id = pr.role_id
      WHERE pr.profile_id = auth.uid() AND r.name = 'admin'
    )
  );

/* 允许所有登录用户读取自定义词库（Server Action 里用 service_role 绕过 RLS 也可以） */
DROP POLICY IF EXISTS "search_dictionary_read_all" ON search_dictionary;
CREATE POLICY "search_dictionary_read_all" ON search_dictionary
  FOR SELECT TO authenticated
  USING (true);
