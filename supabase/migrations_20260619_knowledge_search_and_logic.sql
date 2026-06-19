/* ============================================================
 * 知识库搜索优化：分词后 AND 匹配（无顺序要求）
 *
 * 问题：原函数把查询拆成单字/子串后使用 OR 匹配，
 * 导致搜索"捷达点烟器"时，现代点烟器、捷达 VS7 等
 * 只命中部分词的文章也被返回。
 *
 * 优化：
 * 1. 函数改为接收已分词后的关键词数组 TEXT[]。
 * 2. 要求数组中所有词都必须在标题/内容中出现（AND 关系）。
 * 3. 各词之间不强制顺序，类似淘宝搜索。
 * 4. 完整短语匹配、标题匹配给予更高权重。
 *
 * 分词由前端/Server Action 中的中文分词器完成。
 * ============================================================ */

/* 设置较长超时，避免复杂函数创建/替换超时 */
SET statement_timeout = '60s';

DROP FUNCTION IF EXISTS search_knowledge_articles(TEXT);
DROP FUNCTION IF EXISTS search_knowledge_articles(TEXT[]);

CREATE OR REPLACE FUNCTION search_knowledge_articles(search_keywords TEXT[])
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
  filtered_keywords AS (
    SELECT array_agg(DISTINCT lower(k)) AS kw_arr
    FROM unnest(search_keywords) AS k
    WHERE k IS NOT NULL AND trim(k) <> ''
  ),
  keyword_count AS (
    SELECT count(*) AS total
    FROM unnest((SELECT kw_arr FROM filtered_keywords)) AS k
  ),
  search_phrase AS (
    SELECT lower(trim(array_to_string((SELECT kw_arr FROM filtered_keywords), ' '))) AS phrase
  ),
  scored AS (
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
        -- 完整短语匹配（所有词按顺序）最高权重
        CASE
          WHEN (SELECT phrase FROM search_phrase) <> ''
            AND lower(ka.title) LIKE '%' || (SELECT phrase FROM search_phrase) || '%' THEN 1000
          WHEN (SELECT phrase FROM search_phrase) <> ''
            AND lower(COALESCE(ka.content, '') || ' ' || COALESCE(ka.content_blocks::text, '')) LIKE '%' || (SELECT phrase FROM search_phrase) || '%' THEN 500
          ELSE 0
        END
        +
        COALESCE((
          SELECT sum(CASE
            WHEN lower(ka.title) LIKE lower(k) || '%' THEN 100
            WHEN lower(ka.title) LIKE '%' || lower(k) || '%' THEN 50
            WHEN lower(COALESCE(kc.name, '')) LIKE '%' || lower(k) || '%' THEN 30
            WHEN lower(COALESCE(ka.content, '') || ' ' || COALESCE(ka.content_blocks::text, '')) LIKE '%' || lower(k) || '%' THEN 10
            ELSE 0
          END)
          FROM unnest((SELECT kw_arr FROM filtered_keywords)) AS k
        ), 0)
        +
        COALESCE((
          SELECT count(*) * 20
          FROM unnest((SELECT kw_arr FROM filtered_keywords)) AS k
          WHERE lower(ka.title) LIKE '%' || lower(k) || '%'
        ), 0)
      )::NUMERIC AS score,
      -- 匹配了多少个不同的关键词
      COALESCE((
        SELECT count(DISTINCT k)
        FROM unnest((SELECT kw_arr FROM filtered_keywords)) AS k
        WHERE lower(ka.title) LIKE '%' || lower(k) || '%'
          OR lower(COALESCE(kc.name, '')) LIKE '%' || lower(k) || '%'
          OR lower(COALESCE(ka.content, '') || ' ' || COALESCE(ka.content_blocks::text, '')) LIKE '%' || lower(k) || '%'
      ), 0) AS match_count
    FROM knowledge_articles ka
    LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
    LEFT JOIN profiles p ON ka.created_by = p.id
  )
  SELECT
    s.id,
    s.title,
    s.content,
    s.content_blocks,
    s.type,
    s.created_at,
    s.category_id,
    s.category_name,
    s.author_name,
    s.visibility,
    s.created_by,
    s.score
  FROM scored s
  WHERE s.score >= 1000                              -- 完整短语匹配
     OR s.match_count = (SELECT total FROM keyword_count)  -- 所有关键词都匹配
  ORDER BY s.score DESC, s.created_at DESC;
END;
$$;
