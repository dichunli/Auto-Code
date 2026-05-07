-- 施工组表
CREATE TABLE IF NOT EXISTS mechanic_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 施工组成员表
CREATE TABLE IF NOT EXISTS mechanic_group_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES mechanic_groups(id) ON DELETE CASCADE,
  mechanic_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, mechanic_id)
);

-- 维修项目施工人关联表（支持多人施工和提成分配）
CREATE TABLE IF NOT EXISTS work_order_item_mechanics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  mechanic_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  group_id UUID REFERENCES mechanic_groups(id) ON DELETE SET NULL,
  commission_ratio DECIMAL(5,2) DEFAULT 100.00,
  is_leader BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(work_order_item_id, mechanic_id)
);

-- RLS
ALTER TABLE mechanic_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanic_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_item_mechanics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON mechanic_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON mechanic_group_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_item_mechanics FOR ALL TO authenticated USING (true) WITH CHECK (true);
