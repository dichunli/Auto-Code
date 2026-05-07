-- 施工统计表 V2：车型信息细化，支持按技师分条记录

-- 删除旧表重新创建（如果已存在）
DROP TABLE IF EXISTS work_order_item_construction_stats;

CREATE TABLE IF NOT EXISTS work_order_item_construction_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  -- 车型详细信息
  vehicle_brand TEXT,
  vehicle_series TEXT,
  vehicle_model_name TEXT,
  vehicle_displacement TEXT,
  vehicle_engine TEXT,
  vehicle_chassis TEXT,
  vehicle_transmission TEXT,
  -- 单个技师
  mechanic_name TEXT NOT NULL,
  construction_seconds INTEGER DEFAULT 0,
  pause_seconds INTEGER DEFAULT 0,
  total_seconds INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed' CHECK (status IN ('in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_construction_stats_item ON work_order_item_construction_stats(work_order_item_id);
CREATE INDEX IF NOT EXISTS idx_construction_stats_order ON work_order_item_construction_stats(work_order_id);
CREATE INDEX IF NOT EXISTS idx_construction_stats_item_model ON work_order_item_construction_stats(item_name, vehicle_brand, vehicle_series, vehicle_model_name);

ALTER TABLE work_order_item_construction_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON work_order_item_construction_stats FOR ALL TO authenticated USING (true) WITH CHECK (true);
