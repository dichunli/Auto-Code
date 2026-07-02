/* ============================================================
 * 知识库全文搜索优化
 *
 * 问题：原搜索函数使用 lower(...) LIKE '%...%' 全表扫描，
 * 文章量大时很慢。
 *
 * 优化：
 * 1. 新增 search_text 字段，由应用层写入已分词的搜索文本。
 * 2. 新增 search_vector 字段，基于 search_text 生成 tsvector。
 * 3. 创建 GIN 索引加速 tsvector 匹配。
 * 4. 修改 search_knowledge_articles 函数，使用 tsvector 查询。
 *
 * 中文分词仍由前端中文分词器完成，应用层保存文章时把
 * 标题、内容、内容块文本、分类名、作者名分词后写入
 * search_text，数据库只负责索引和快速匹配。
 * ============================================================ */

SET statement_timeout = '120s';

/* 1. 新增搜索字段 */
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS search_text TEXT;
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

/* 2. 创建 GIN 索引 */
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_search_vector
  ON knowledge_articles USING GIN (search_vector);

/* 3. 辅助函数：从 JSONB content_blocks 中提取纯文本 */
CREATE OR REPLACE FUNCTION extract_knowledge_blocks_text(blocks JSONB)
RETURNS TEXT AS $$
DECLARE
  result TEXT := '';
  item JSONB;
  child JSONB;
  grandchild JSONB;
BEGIN
  IF blocks IS NULL OR jsonb_typeof(blocks) <> 'array' THEN
    RETURN '';
  END IF;

  FOR item IN SELECT jsonb_array_elements(blocks) LOOP
    /* 提取当前块 content 中的 text（只处理数组类型的 content） */
    IF jsonb_typeof(item -> 'content') = 'array' THEN
      FOR child IN SELECT jsonb_array_elements(item -> 'content') LOOP
        IF jsonb_typeof(child) = 'object' THEN
          IF child ->> 'text' IS NOT NULL THEN
            result := result || ' ' || (child ->> 'text');
          /* 链接块：text 嵌套在 content 数组里 */
          ELSIF jsonb_typeof(child -> 'content') = 'array' THEN
            FOR grandchild IN SELECT jsonb_array_elements(child -> 'content') LOOP
              IF jsonb_typeof(grandchild) = 'object' AND grandchild ->> 'text' IS NOT NULL THEN
                result := result || ' ' || (grandchild ->> 'text');
              END IF;
            END LOOP;
          END IF;
        END IF;
      END LOOP;
    END IF;

    /* 递归提取子块 */
    IF jsonb_typeof(item -> 'children') = 'array' THEN
      result := result || ' ' || extract_knowledge_blocks_text(item -> 'children');
    END IF;
  END LOOP;

  RETURN trim(coalesce(result, ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

/* 4. 触发器函数：自动更新 search_vector */
CREATE OR REPLACE FUNCTION update_knowledge_article_search_vector()
RETURNS TRIGGER AS $$
DECLARE
  cat_name TEXT;
  author_name TEXT;
  blocks_text TEXT;
  raw_text TEXT;
BEGIN
  SELECT name INTO cat_name FROM knowledge_categories WHERE id = NEW.category_id;
  SELECT full_name INTO author_name FROM profiles WHERE id = NEW.created_by;

  blocks_text := extract_knowledge_blocks_text(NEW.content_blocks);

  raw_text := coalesce(NEW.search_text, '') || ' ' ||
              coalesce(NEW.title, '') || ' ' ||
              coalesce(NEW.content, '') || ' ' ||
              blocks_text || ' ' ||
              coalesce(cat_name, '') || ' ' ||
              coalesce(author_name, '');

  NEW.search_vector := to_tsvector('simple', raw_text);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

/* 5. 创建触发器 */
DROP TRIGGER IF EXISTS knowledge_articles_search_vector_trigger ON knowledge_articles;
CREATE TRIGGER knowledge_articles_search_vector_trigger
BEFORE INSERT OR UPDATE ON knowledge_articles
FOR EACH ROW
EXECUTE FUNCTION update_knowledge_article_search_vector();

/* 6. 初始化现有数据：用标题和内容生成基础搜索文本。
   中文未分词，但 tsvector simple 解析器会按空格和标点处理。
   新保存的文章由应用层写入已分词的 search_text。 */
UPDATE knowledge_articles
SET search_text = coalesce(title, '') || ' ' || coalesce(content, '')
WHERE search_text IS NULL OR search_text = '';

/* 7. 修改搜索函数：使用 tsvector 全文索引 */
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
DECLARE
  query TSQUERY;
  phrase TEXT;
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
  phrase := lower(array_to_string(search_keywords, ' '));

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
    (
      /* 标题完整短语匹配最高权重 */
      CASE WHEN lower(ka.title) LIKE '%' || phrase || '%' THEN 1000 ELSE 0 END +
      /* 标题部分匹配 */
      CASE WHEN lower(ka.title) LIKE '%' || split_part(phrase, ' ', 1) || '%' THEN 100 ELSE 0 END +
      /* tsvector 相关性排名 */
      coalesce(ts_rank(ka.search_vector, query) * 100, 0)
    )::NUMERIC AS score
  FROM knowledge_articles ka
  LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
  LEFT JOIN profiles p ON ka.created_by = p.id
  WHERE ka.search_vector @@ query
  ORDER BY score DESC, ka.created_at DESC;
END;
$$;
