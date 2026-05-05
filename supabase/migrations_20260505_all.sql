-- 2026-05-05 全部迁移（配件相关）

-- 1. 配件互换码
ALTER TABLE parts ADD COLUMN IF NOT EXISTS interchange_code TEXT;
CREATE INDEX IF NOT EXISTS idx_parts_interchange ON parts(interchange_code);

-- 2. 配件VIP价
ALTER TABLE parts ADD COLUMN IF NOT EXISTS vip_price DECIMAL(10,2);

-- 3. 配件多价格体系
ALTER TABLE parts ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(10,2);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS reference_purchase_price DECIMAL(10,2);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS standard_price DECIMAL(10,2);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS wholesale_price DECIMAL(10,2);

-- 4. 配件单据名称（采购单上的配件名称）
ALTER TABLE parts ADD COLUMN IF NOT EXISTS document_name TEXT;
CREATE INDEX IF NOT EXISTS idx_parts_document_name ON parts(document_name);

-- 5. 仓库与配件仓位库存
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

-- 6. 仓库表 RLS
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_warehouses" ON warehouses;
CREATE POLICY "allow_all_warehouses" ON warehouses
  FOR ALL USING (true) WITH CHECK (true);

-- 7. 仓库仓位定义表
CREATE TABLE IF NOT EXISTS warehouse_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(warehouse_id, name)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_locations_warehouse ON warehouse_locations(warehouse_id);

-- 配件仓位库存表 RLS
ALTER TABLE part_stock_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_part_stock_locations" ON part_stock_locations;
CREATE POLICY "allow_all_part_stock_locations" ON part_stock_locations
  FOR ALL USING (true) WITH CHECK (true);

-- 仓库仓位定义表 RLS
ALTER TABLE warehouse_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_warehouse_locations" ON warehouse_locations;
CREATE POLICY "allow_all_warehouse_locations" ON warehouse_locations
  FOR ALL USING (true) WITH CHECK (true);

-- 8. 配件车型定价
CREATE TABLE IF NOT EXISTS part_vehicle_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  vehicle_model_id UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  UNIQUE(part_id, vehicle_model_id)
);

CREATE INDEX IF NOT EXISTS idx_part_vehicle_prices ON part_vehicle_prices(part_id, vehicle_model_id);

ALTER TABLE part_vehicle_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_part_vehicle_prices" ON part_vehicle_prices;
CREATE POLICY "allow_all_part_vehicle_prices" ON part_vehicle_prices
  FOR ALL USING (true) WITH CHECK (true);

-- 9. 车型定价扩展三价格字段
ALTER TABLE part_vehicle_prices
  ADD COLUMN IF NOT EXISTS sales_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS vip_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS standard_price DECIMAL(10,2);

-- 10. 指定用户价格（统一表：单位/客户/车辆任意组合）
CREATE TABLE IF NOT EXISTS part_special_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (company_id IS NOT NULL OR customer_id IS NOT NULL OR vehicle_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_part_special_prices_part ON part_special_prices(part_id);
CREATE INDEX IF NOT EXISTS idx_part_special_prices_company ON part_special_prices(company_id);
CREATE INDEX IF NOT EXISTS idx_part_special_prices_customer ON part_special_prices(customer_id);
CREATE INDEX IF NOT EXISTS idx_part_special_prices_vehicle ON part_special_prices(vehicle_id);

ALTER TABLE part_special_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_part_special_prices" ON part_special_prices;
CREATE POLICY "allow_all_part_special_prices" ON part_special_prices
  FOR ALL USING (true) WITH CHECK (true);

-- 11. 仓位安全库存上下限
ALTER TABLE part_stock_locations
  ADD COLUMN IF NOT EXISTS min_stock INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_stock INTEGER;

-- 12. 配件系统码
ALTER TABLE parts ADD COLUMN IF NOT EXISTS system_code TEXT UNIQUE;

-- 13. 配件条形码
ALTER TABLE parts ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_parts_barcode ON parts(barcode);

-- 14. 配件与规格多对多关联
CREATE TABLE IF NOT EXISTS parts_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  specification_id UUID NOT NULL REFERENCES part_specifications(id) ON DELETE CASCADE,
  UNIQUE(part_id, specification_id)
);
CREATE INDEX IF NOT EXISTS idx_ps_part ON parts_specifications(part_id);
CREATE INDEX IF NOT EXISTS idx_ps_spec ON parts_specifications(specification_id);
