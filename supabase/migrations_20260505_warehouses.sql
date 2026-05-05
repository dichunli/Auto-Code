-- 仓库与配件仓位库存

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS part_stock_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id),
  location TEXT,
  quantity INTEGER DEFAULT 0 NOT NULL,
  UNIQUE(part_id, warehouse_id, location)
);

CREATE INDEX IF NOT EXISTS idx_psl_part ON part_stock_locations(part_id);
CREATE INDEX IF NOT EXISTS idx_psl_warehouse ON part_stock_locations(warehouse_id);
