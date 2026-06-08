/* ============================================================
   知识库权限控制 + 阅读量统计
   ============================================================ */

/* 1. 知识库文章增加阅读权限字段 */
ALTER TABLE knowledge_articles
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public';

/* 添加 CHECK 约束 */
ALTER TABLE knowledge_articles
  DROP CONSTRAINT IF EXISTS knowledge_articles_visibility_check;

ALTER TABLE knowledge_articles
  ADD CONSTRAINT knowledge_articles_visibility_check
  CHECK (visibility IN ('public', 'internal', 'private'));

/* 已有数据默认设为 public */
UPDATE knowledge_articles SET visibility = 'public' WHERE visibility IS NULL;

/* 2. 创建阅读记录表（1天内重复阅读不统计） */
CREATE TABLE IF NOT EXISTS knowledge_article_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_date DATE DEFAULT CURRENT_DATE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id, user_id, read_date)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_reads_article ON knowledge_article_reads(article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_reads_user ON knowledge_article_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_reads_date ON knowledge_article_reads(read_date);

ALTER TABLE knowledge_article_reads ENABLE ROW LEVEL SECURITY;

/* 阅读记录：只能插入自己的，可以查看所有 */
CREATE POLICY "knowledge_reads_insert_own" ON knowledge_article_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "knowledge_reads_select_all" ON knowledge_article_reads
  FOR SELECT TO authenticated
  USING (true);

/* 3. 更新知识库文章 RLS 策略 */
/* 先删除旧策略 */
DROP POLICY IF EXISTS "auth_full_access" ON knowledge_articles;

/* 管理员拥有所有权限 */
CREATE POLICY "knowledge_admin_all" ON knowledge_articles
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

/* 创建者可以管理自己的文章 */
CREATE POLICY "knowledge_owner_manage" ON knowledge_articles
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

/* 所有登录用户可以查看 public 和 internal 的文章 */
CREATE POLICY "knowledge_public_read" ON knowledge_articles
  FOR SELECT TO authenticated
  USING (visibility IN ('public', 'internal'));

/* 4. 更新全文搜索函数（添加 visibility 和 created_by 字段） */
/* 必须先删除旧函数，因为返回类型变了 */
DROP FUNCTION IF EXISTS search_knowledge_articles(TEXT);

CREATE FUNCTION search_knowledge_articles(search_query TEXT)
RETURNS TABLE(
  id UUID,
  title TEXT,
  content TEXT,
  content_blocks JSONB,
  type TEXT,
  created_at TIMESTAMPTZ,
  category_id UUID,
  category_name TEXT,
  author_name TEXT,
  visibility TEXT,
  created_by UUID,
  score NUMERIC
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH
  raw_keywords AS (
    SELECT array_agg(w) AS kw_arr
    FROM unnest(regexp_split_to_array(trim(search_query), '\s+')) AS w
    WHERE w <> ''
  ),
  substrings AS (
    SELECT DISTINCT substring(kw, i, 2) AS s
    FROM unnest((SELECT kw_arr FROM raw_keywords)) AS kw,
         generate_series(1, GREATEST(length(kw) - 1, 1)) AS i
    WHERE length(kw) >= 2
  ),
  keyword_list AS (
    SELECT w AS kw FROM unnest((SELECT kw_arr FROM raw_keywords)) AS w
    UNION
    SELECT s AS kw FROM substrings
  )
  SELECT
    ka.id,
    ka.title,
    ka.content,
    ka.content_blocks,
    ka.type,
    ka.created_at,
    ka.category_id,
    kc.name AS category_name,
    p.full_name AS author_name,
    ka.visibility,
    ka.created_by,
    (
      COALESCE((
        SELECT sum(CASE
          WHEN lower(ka.title) LIKE lower(kl.kw) || '%' THEN 100
          WHEN lower(ka.title) LIKE '%' || lower(kl.kw) || '%' THEN 50
          WHEN lower(COALESCE(kc.name, '')) LIKE '%' || lower(kl.kw) || '%' THEN 30
          WHEN lower(COALESCE(ka.content, '') || ' ' || COALESCE(ka.content_blocks::text, '')) LIKE '%' || lower(kl.kw) || '%' THEN 10
          ELSE 0
        END)
        FROM keyword_list kl
      ), 0) +
      COALESCE((
        SELECT count(*) * 20
        FROM keyword_list kl
        WHERE lower(ka.title) LIKE '%' || lower(kl.kw) || '%'
      ), 0)
    )::NUMERIC AS score
  FROM knowledge_articles ka
  LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
  LEFT JOIN profiles p ON ka.created_by = p.id
  WHERE EXISTS (
    SELECT 1 FROM keyword_list kl
    WHERE lower(ka.title) LIKE '%' || lower(kl.kw) || '%'
      OR lower(COALESCE(kc.name, '')) LIKE '%' || lower(kl.kw) || '%'
      OR lower(COALESCE(ka.content, '') || ' ' || COALESCE(ka.content_blocks::text, '')) LIKE '%' || lower(kl.kw) || '%'
  )
  ORDER BY score DESC, ka.created_at DESC;
END;
$$;
