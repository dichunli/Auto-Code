/* ============================================================
 * 语义搜索 v2：混合打分 + 相似度门槛
 *
 * 改进：
 * 1. 新增搜索关键词参数 → 标题匹配加分（混合打分）
 * 2. 相似度门槛 ≥ 0.15，过滤不相关结果
 * 3. 混合公式：相似度(60%) + 标题关键词匹配(40%)
 * ============================================================ */

SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION search_knowledge_semantic(
  query_embedding extensions.vector(384),
  p_search_keywords TEXT DEFAULT NULL,
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
DECLARE
  keyword_score FLOAT;
  min_similarity FLOAT := 0.15;
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
    /* 混合打分：语义相似度 60% + 标题关键词匹配 40% */
    ROUND(((1 - (ka.embedding <=> query_embedding)) * 0.6 +
     CASE
       WHEN p_search_keywords IS NOT NULL AND p_search_keywords <> '' THEN
         (CASE WHEN lower(ka.title) LIKE '%' || lower(p_search_keywords) || '%' THEN 0.4 ELSE 0 END)
       ELSE 0
     END)::numeric, 4) AS similarity,
    COUNT(*) OVER() AS total_count
  FROM knowledge_articles ka
  LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
  LEFT JOIN profiles p ON ka.created_by = p.id
  WHERE ka.embedding IS NOT NULL
    AND (p_category_id IS NULL OR ka.category_id = p_category_id)
    /* 相似度门槛：过滤噪音 */
    AND (1 - (ka.embedding <=> query_embedding)) > min_similarity
  ORDER BY similarity DESC, ka.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
