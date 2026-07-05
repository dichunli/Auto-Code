/* ============================================================
 * 语义搜索 v3：回归简洁
 *
 * - 去掉相似度门槛（不过滤结果）
 * - 去掉复杂的混合打分（纯余弦相似度，简单可靠）
 * ============================================================ */

SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION search_knowledge_semantic(
  query_embedding extensions.vector(384),
  p_category_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
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
  similarity FLOAT,
  total_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
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
    ROUND((1 - (ka.embedding <=> query_embedding))::numeric, 4) AS similarity,
    COUNT(*) OVER() AS total_count
  FROM knowledge_articles ka
  LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
  LEFT JOIN profiles p ON ka.created_by = p.id
  WHERE ka.embedding IS NOT NULL
    AND (p_category_id IS NULL OR ka.category_id = p_category_id)
  ORDER BY ka.embedding <=> query_embedding
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
