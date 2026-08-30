ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_warehouses" ON warehouses;
CREATE POLICY "allow_all_warehouses" ON warehouses FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE part_stock_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_part_stock_locations" ON part_stock_locations;
CREATE POLICY "allow_all_part_stock_locations" ON part_stock_locations FOR ALL USING (true) WITH CHECK (true);
