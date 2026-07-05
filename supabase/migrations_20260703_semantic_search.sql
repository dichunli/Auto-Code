/* ============================================================
 * 知识库语义搜索：基于百度千帆 Embedding-V1 + pgvector
 *
 * 1. 启用 pgvector 扩展
 * 2. 添加 embedding 列（384 维向量）
 * 3. 创建语义搜索函数
 * ============================================================ */

SET statement_timeout = '120s';

/* 启用 pgvector 扩展 */
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

/* 添加/更新向量列为 384 维（embedding-v1 实际输出 384 维） */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_articles' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE knowledge_articles ALTER COLUMN embedding TYPE extensions.vector(384);
  ELSE
    ALTER TABLE knowledge_articles ADD COLUMN embedding extensions.vector(384);
  END IF;
END $$;

/* 创建语义搜索函数 */
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
    /* 余弦相似度：1 - 余弦距离，越接近 1 越相似 */
    (1 - (ka.embedding <=> query_embedding))::FLOAT AS similarity,
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
