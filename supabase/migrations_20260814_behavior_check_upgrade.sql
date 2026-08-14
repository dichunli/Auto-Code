/* ============================================================
   行为考核模块升级
   1. 新建 behavior_categories 行为分类表（如：早会检查卫生）
   2. 新建 behavior_item_details 检查细节表（逐条打分用）
   3. behavior_score_items 加：分类/责任人/检查人
   4. behavior_check_tasks 加：end_time 检查结束时间（超时关闭）
   5. behavior_check_records 加：checker_id 检查人快照 + detail_results 逐条打分结果
   6. 新建 behavior_check_comments 检查评论表
   向后兼容：所有新列可空或有默认值，旧任务/旧记录行为不变
   ============================================================ */

/* -----------------------------------------------------------
   1. 行为分类表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS behavior_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_categories_sort ON behavior_categories(sort_order);

ALTER TABLE behavior_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full_access" ON behavior_categories;
CREATE POLICY "auth_full_access" ON behavior_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* -----------------------------------------------------------
   2. 检查细节表（项目下的逐条检查点，删项目级联删细节）
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS behavior_item_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES behavior_score_items(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  guide_images JSONB DEFAULT '[]',
  score_value INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_item_details_item ON behavior_item_details(item_id);

ALTER TABLE behavior_item_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full_access" ON behavior_item_details;
CREATE POLICY "auth_full_access" ON behavior_item_details FOR ALL TO authenticated USING (true) WITH CHECK (true);

/* -----------------------------------------------------------
   3. 行为项目加列
   category_id     所属分类（删分类时置 NULL，项目保留为"未分类"）
   responsible_id  责任人（被考核人；NULL = 旧模式，走任务 employee_ids）
   checker_id      检查人（NULL = 责任人自检；仅在责任人模式下生效）
   ----------------------------------------------------------- */
ALTER TABLE behavior_score_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES behavior_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checker_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_behavior_score_items_category ON behavior_score_items(category_id);
CREATE INDEX IF NOT EXISTS idx_behavior_score_items_responsible ON behavior_score_items(responsible_id);

/* -----------------------------------------------------------
   4. 考核任务加结束时间
   execute_time 语义从"仅展示"变为"检查开始时间"
   end_time 旧数据默认 23:59 = 全天可检，旧任务行为不变
   ----------------------------------------------------------- */
ALTER TABLE behavior_check_tasks
  ADD COLUMN IF NOT EXISTS end_time TIME NOT NULL DEFAULT '23:59';

/* -----------------------------------------------------------
   5. 检查记录加列
   checker_id      应检查人快照（生成记录时写入，之后改项目配置不影响当天记录）
                   NULL = 旧数据，语义为自检（检查人=employee_id）
   detail_results  逐条细节打分结果快照，元素结构：
                   [{detail_id, name, full_score, given, photos: [], note}]
                   存快照是为了以后改/删细节定义后历史记录仍原样可查
   ----------------------------------------------------------- */
ALTER TABLE behavior_check_records
  ADD COLUMN IF NOT EXISTS checker_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS detail_results JSONB DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_behavior_check_records_checker ON behavior_check_records(checker_id);

/* -----------------------------------------------------------
   6. 检查评论表（挂在检查记录上，随记录级联删除）
   挂检查记录而非打分流水：漏检关闭的记录没有打分流水，
   但恰恰最需要评论（责任人解释漏检原因）
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS behavior_check_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_record_id UUID NOT NULL REFERENCES behavior_check_records(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_check_comments_record ON behavior_check_comments(check_record_id);

ALTER TABLE behavior_check_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full_access" ON behavior_check_comments;
CREATE POLICY "auth_full_access" ON behavior_check_comments FOR ALL TO authenticated USING (true) WITH CHECK (true);
