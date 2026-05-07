-- 项目施工用时统计表
CREATE TABLE IF NOT EXISTS work_order_item_construction_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  vehicle_model TEXT,
  mechanics TEXT NOT NULL,
  construction_seconds INTEGER DEFAULT 0,
  pause_seconds INTEGER DEFAULT 0,
  total_seconds INTEGER DEFAULT 0,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_construction_stats_item ON work_order_item_construction_stats(work_order_item_id);
CREATE INDEX IF NOT EXISTS idx_construction_stats_order ON work_order_item_construction_stats(work_order_id);

ALTER TABLE work_order_item_construction_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON work_order_item_construction_stats FOR ALL TO authenticated USING (true) WITH CHECK (true);
