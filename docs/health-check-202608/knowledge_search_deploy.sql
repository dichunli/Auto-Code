SET statement_timeout = '120s';

ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS search_text TEXT;
ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_search_vector
  ON knowledge_articles USING GIN (search_vector);

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
    IF jsonb_typeof(item -> 'content') = 'array' THEN
      FOR child IN SELECT jsonb_array_elements(item -> 'content') LOOP
        IF jsonb_typeof(child) = 'object' THEN
          IF child ->> 'text' IS NOT NULL THEN
            result := result || ' ' || (child ->> 'text');
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

    IF jsonb_typeof(item -> 'children') = 'array' THEN
      result := result || ' ' || extract_knowledge_blocks_text(item -> 'children');
    END IF;
  END LOOP;

  RETURN trim(coalesce(result, ''));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

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

DROP TRIGGER IF EXISTS knowledge_articles_search_vector_trigger ON knowledge_articles;
CREATE TRIGGER knowledge_articles_search_vector_trigger
BEFORE INSERT OR UPDATE ON knowledge_articles
FOR EACH ROW
EXECUTE FUNCTION update_knowledge_article_search_vector();

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
  search_keywords := array(
    SELECT DISTINCT lower(trim(k))
    FROM unnest(search_keywords) AS k
    WHERE k IS NOT NULL AND trim(k) <> ''
  );

  IF array_length(search_keywords, 1) IS NULL THEN
    RETURN;
  END IF;

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
      CASE WHEN lower(ka.title) LIKE '%' || phrase || '%' THEN 1000 ELSE 0 END +
      CASE WHEN lower(ka.title) LIKE '%' || split_part(phrase, ' ', 1) || '%' THEN 100 ELSE 0 END +
      coalesce(ts_rank(ka.search_vector, query) * 100, 0)
    )::NUMERIC AS score
  FROM knowledge_articles ka
  LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
  LEFT JOIN profiles p ON ka.created_by = p.id
  WHERE ka.search_vector @@ query
  ORDER BY score DESC, ka.created_at DESC;
END;
$$;

UPDATE knowledge_articles
SET search_text = coalesce(title, '') || ' ' || coalesce(content, '')
WHERE search_text IS NULL OR search_text = '';
