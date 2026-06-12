/* ============================================================
   工具管理
   - 工具基础信息：编码、名称、图片、使用说明、知识库关联、存放位置、状态
   - 工具借用记录：借用人、借用时间、归还人、归还时间
   ============================================================ */

CREATE TABLE tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  image_url TEXT,
  instructions TEXT,
  knowledge_article_id UUID REFERENCES knowledge_articles(id) ON DELETE SET NULL,
  location TEXT,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'borrowed', 'scrapped')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tools_code ON tools(code);
CREATE INDEX idx_tools_name ON tools(name);
CREATE INDEX idx_tools_status ON tools(status);
CREATE INDEX idx_tools_knowledge_article ON tools(knowledge_article_id);

CREATE TABLE tool_borrow_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  borrower_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  borrowed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  returner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  returned_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_borrow_records_tool_id ON tool_borrow_records(tool_id);
CREATE INDEX idx_tool_borrow_records_borrowed_at ON tool_borrow_records(borrowed_at);
CREATE INDEX idx_tool_borrow_records_open ON tool_borrow_records(tool_id, returned_at) WHERE returned_at IS NULL;

/* RLS */
ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_borrow_records ENABLE ROW LEVEL SECURITY;

/* tools 表：所有认证用户可读 */
CREATE POLICY tools_select_all ON tools
  FOR SELECT TO authenticated USING (true);

/* tools 表：仅管理员可写 */
CREATE POLICY tools_write_admin ON tools
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

/* tool_borrow_records 表：所有认证用户可读写 */
CREATE POLICY tool_borrow_records_all ON tool_borrow_records
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
