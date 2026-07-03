/* ============================================================
 * 知识库搜索 v3：支持数据库层分页和分类筛选
 *
 * 问题：v2 版返回全部匹配结果，前端再分页/过滤，
 * 内容多时传输数据量过大（content_blocks 是 JSONB 大字段）。
 *
 * 改进：
 * 1. 新增 p_limit / p_offset 分页参数
 * 2. 新增 p_category_id 筛选参数
 * 3. 使用 COUNT(*) OVER() 一次查询同时返回总数
 * 4. 简化评分逻辑（去掉低效的 LIKE 评分，纯靠 ts_rank）
 * ============================================================ */

SET statement_timeout = '120s';

DROP FUNCTION IF EXISTS search_knowledge_articles(TEXT);
DROP FUNCTION IF EXISTS search_knowledge_articles(TEXT[]);

CREATE OR REPLACE FUNCTION search_knowledge_articles(
  search_keywords TEXT[],
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
  score NUMERIC,
  total_count BIGINT
) LANGUAGE plpgsql AS $$
DECLARE
  query TSQUERY;
BEGIN
  /* 过滤空关键词 */
  search_keywords := array(
    SELECT DISTINCT lower(trim(k))
    FROM unnest(search_keywords) AS k
    WHERE k IS NOT NULL AND trim(k) <> ''
  );

  IF array_length(search_keywords, 1) IS NULL THEN
    RETURN;
  END IF;

  /* 用 AND 关系构建 tsquery */
  query := to_tsquery('simple', array_to_string(search_keywords, ' & '));

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
    /* 纯 ts_rank 评分（GIN 索引加速，比 LIKE 快很多） */
    coalesce(ts_rank(ka.search_vector, query) * 100, 0)::NUMERIC AS score,
    /* 窗口函数：一次查询拿到总数 */
    COUNT(*) OVER() AS total_count
  FROM knowledge_articles ka
  LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
  LEFT JOIN profiles p ON ka.created_by = p.id
  WHERE ka.search_vector @@ query
    AND (p_category_id IS NULL OR ka.category_id = p_category_id)
  ORDER BY score DESC, ka.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
