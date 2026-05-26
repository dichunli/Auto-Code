/* 知识库支持块级编辑器：新增 content_blocks 字段 */

ALTER TABLE knowledge_articles ADD COLUMN IF NOT EXISTS content_blocks JSONB;

/* 为 JSONB 字段建 GIN 索引 */
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_blocks ON knowledge_articles USING GIN (content_blocks);
