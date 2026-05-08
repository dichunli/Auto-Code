-- 知识库增加维修指导类型及车型关联

-- 1. 增加维修指导类型到 knowledge_articles
ALTER TABLE knowledge_articles DROP CONSTRAINT IF EXISTS knowledge_articles_type_check;
ALTER TABLE knowledge_articles ADD CONSTRAINT knowledge_articles_type_check CHECK (type IN ('article', 'video', 'qa', 'guide'));

-- 2. 创建知识库文章与车型关联表
CREATE TABLE IF NOT EXISTS knowledge_vehicle_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  vehicle_model_id INTEGER NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  UNIQUE(article_id, vehicle_model_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_vehicle_links_article ON knowledge_vehicle_links(article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_vehicle_links_model ON knowledge_vehicle_links(vehicle_model_id);

ALTER TABLE knowledge_vehicle_links ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "auth_full_access" ON knowledge_vehicle_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
