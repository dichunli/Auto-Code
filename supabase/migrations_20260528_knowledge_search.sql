/* ============================================================
   知识库分词搜索函数
   支持按空格分隔多关键词，按相关性评分排序返回结果
   ============================================================ */

CREATE OR REPLACE FUNCTION search_knowledge_articles(search_query TEXT)
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
  score NUMERIC
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH
  keywords AS (
    SELECT array_agg(w) AS kw_arr
    FROM unnest(regexp_split_to_array(trim(search_query), '\s+')) AS w
    WHERE w <> ''
  ),
  keyword_list AS (
    SELECT w AS kw FROM unnest((SELECT kw_arr FROM keywords)) AS w
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
