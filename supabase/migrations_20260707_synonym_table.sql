/* ============================================================
 * 语义搜索同义词扩展 + 混合打分增强
 *
 * 1. synonym_mapping 表：存储同义词/专业术语映射
 *    搜"刹车"自动扩展到"制动 制动片 刹车盘"
 * 2. search_scoring_rules 表：关键词命中加分规则
 *    标题命中 +20 分，OE号精确匹配 +50 分
 * ============================================================ */

/* 同义词映射表 */
CREATE TABLE IF NOT EXISTS synonym_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,             /* 原始词，如"刹车" */
  synonyms TEXT[] NOT NULL,       /* 同义词数组，如 ["制动","制动系统"] */
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

/* 索引：快速查找某个词的同义词 */
CREATE INDEX IF NOT EXISTS idx_synonym_term ON synonym_mapping (term);

/* RLS 策略：所有人可读，仅 admin 可写 */
ALTER TABLE synonym_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "所有人可查看同义词" ON synonym_mapping;
CREATE POLICY "所有人可查看同义词" ON synonym_mapping
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin 可管理同义词" ON synonym_mapping;
CREATE POLICY "admin 可管理同义词" ON synonym_mapping
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profile_roles pr
      JOIN roles r ON pr.role_id = r.id
      WHERE pr.profile_id = auth.uid() AND r.name = 'admin'
    )
  );

/* 预置一些汽修常用同义词 */
INSERT INTO synonym_mapping (term, synonyms) VALUES
  ('刹车', ARRAY['制动', '制动系统', '刹车片', '刹车盘']),
  ('发动机', ARRAY['引擎', '动力总成']),
  ('变速箱', ARRAY['变速器', '波箱', '传动系统']),
  ('空调', ARRAY['冷气', '制冷', '暖风']),
  ('转向', ARRAY['方向', '方向盘', '转向系统']),
  ('悬挂', ARRAY['减震', '避震', '底盘']),
  ('轮胎', ARRAY['车胎', '轮毂']),
  ('电路', ARRAY['线路', '电器', '电子系统']),
  ('机油', ARRAY['润滑油', '发动机油']),
  ('异响', ARRAY['噪音', '响声', '杂音'])
ON CONFLICT DO NOTHING;

/* ═════════════════════════════════════════════════════════════════
 * 混合打分搜索函数 v4
 *
 * 在纯余弦相似度基础上，加入关键词命中加分：
 * - 标题命中 +20 分
 * - 同义词命中 +10 分
 * - 最终排序 = 相似度 × 70% + 关键词加分归一化 × 30%
 * ═════════════════════════════════════════════════════════════════ */

CREATE OR REPLACE FUNCTION search_knowledge_semantic_v4(
  query_embedding extensions.vector(384),
  p_search_terms TEXT[] DEFAULT NULL,   /* 原始搜索词 + 扩展词 */
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
  keyword_score INT,
  final_score FLOAT,
  total_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH semantic_results AS (
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
      /* 关键词命中加分 */
      CASE
        WHEN p_search_terms IS NULL OR array_length(p_search_terms, 1) IS NULL THEN 0
        ELSE (
          /* 标题命中：每个词 +20 */
          (SELECT COUNT(*) * 20 FROM unnest(p_search_terms) t
           WHERE ka.title ILIKE '%' || t || '%')
          +
          /* 同义词命中：每个词 +10 */
          (SELECT COUNT(*) * 10 FROM unnest(p_search_terms) t
           WHERE ka.content ILIKE '%' || t || '%')
        )
      END AS keyword_score
    FROM knowledge_articles ka
    LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
    LEFT JOIN profiles p ON ka.created_by = p.id
    WHERE ka.embedding IS NOT NULL
      AND (p_category_id IS NULL OR ka.category_id = p_category_id)
  )
  SELECT
    sr.*,
    /* 混合打分：70% 语义 + 30% 关键词（归一化到 0-1） */
    ROUND(
      (sr.similarity * 0.7 +
       CASE
         WHEN sr.keyword_score > 0
         THEN LEAST(sr.keyword_score, 50)::numeric / 50 * 0.3
         ELSE 0
       END
      )::numeric,
    4) AS final_score,
    COUNT(*) OVER() AS total_count
  FROM semantic_results sr
  ORDER BY
    /* 最终混合分 × 100 DESC，同级按相似度 */
    (sr.similarity * 0.7 +
     CASE
       WHEN sr.keyword_score > 0
       THEN LEAST(sr.keyword_score, 50)::numeric / 50 * 0.3
       ELSE 0
     END) DESC,
    sr.similarity DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
