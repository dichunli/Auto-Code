/* ============================================================
   员工培训晋级系统 - 阶段二迁移
   1. 新建 behavior_score_items 行为规范加减分项目表
   2. 新建 behavior_score_records 行为规范打分记录表
   3. 新建 rework_records 返工记录表
   4. 新建 daily_loss_records 日常损失记录表
   ============================================================ */

/* -----------------------------------------------------------
   1. 行为规范加减分项目表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS behavior_score_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  score_type TEXT NOT NULL CHECK (score_type IN ('bonus','penalty')),
  score_value INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

/* -----------------------------------------------------------
   2. 行为规范打分记录表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS behavior_score_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES behavior_score_items(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  notes TEXT,
  scored_by UUID REFERENCES profiles(id),
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_behavior_score_employee ON behavior_score_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_behavior_score_scored_at ON behavior_score_records(scored_at);

/* -----------------------------------------------------------
   3. 返工记录表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS rework_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  rework_work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  loss_amount DECIMAL(10,2) DEFAULT 0,
  recorded_by UUID REFERENCES profiles(id),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rework_employee ON rework_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_rework_recorded_at ON rework_records(recorded_at);

/* -----------------------------------------------------------
   4. 日常损失记录表
   ----------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS daily_loss_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  loss_type TEXT NOT NULL,
  description TEXT NOT NULL,
  loss_amount DECIMAL(10,2) DEFAULT 0,
  recorded_by UUID REFERENCES profiles(id),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_loss_employee ON daily_loss_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_loss_recorded_at ON daily_loss_records(recorded_at);

/* -----------------------------------------------------------
   5. RLS 策略
   ----------------------------------------------------------- */
ALTER TABLE behavior_score_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_score_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_loss_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON behavior_score_items;
CREATE POLICY "auth_full_access" ON behavior_score_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_access" ON behavior_score_records;
CREATE POLICY "auth_full_access" ON behavior_score_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_access" ON rework_records;
CREATE POLICY "auth_full_access" ON rework_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_access" ON daily_loss_records;
CREATE POLICY "auth_full_access" ON daily_loss_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
