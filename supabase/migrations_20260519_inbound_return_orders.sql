/* 入库单与采退单表结构迁移 */
/* 创建日期: 2026-05-19 */

/* ============================================================
   一、入库单主表
   ============================================================ */
CREATE TABLE IF NOT EXISTS inbound_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_no TEXT NOT NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2),
  freight_amount DECIMAL(10,2) DEFAULT 0,
  waybill_id UUID REFERENCES logistics_waybills(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'completed' CHECK (status IN ('draft','completed')),
  notes TEXT,
  operator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inbound_orders_purchase_order_id ON inbound_orders(purchase_order_id);
CREATE INDEX idx_inbound_orders_supplier_id ON inbound_orders(supplier_id);
CREATE INDEX idx_inbound_orders_created_at ON inbound_orders(created_at DESC);
CREATE INDEX idx_inbound_orders_inbound_no ON inbound_orders(inbound_no);

/* 入库单号生成触发器 */
CREATE OR REPLACE FUNCTION generate_inbound_no()
RETURNS TRIGGER AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(inbound_no, '^RK-' || today || '-', ''), '')), '0')::INTEGER + 1
  INTO seq_num FROM inbound_orders WHERE inbound_no LIKE 'RK-' || today || '-%';
  NEW.inbound_no := 'RK-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_inbound_no ON inbound_orders;
CREATE TRIGGER set_inbound_no BEFORE INSERT ON inbound_orders
  FOR EACH ROW WHEN (NEW.inbound_no IS NULL) EXECUTE FUNCTION generate_inbound_no();

/* ============================================================
   二、入库单明细表
   ============================================================ */
CREATE TABLE IF NOT EXISTS inbound_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_order_id UUID NOT NULL REFERENCES inbound_orders(id) ON DELETE CASCADE,
  purchase_order_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
  part_number TEXT,
  name TEXT,
  brand TEXT,
  specification TEXT,
  unit TEXT,
  quantity INTEGER NOT NULL,
  unit_cost DECIMAL(10,2),
  allocated_cost DECIMAL(10,2),
  batch_no TEXT,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inbound_order_items_order_id ON inbound_order_items(inbound_order_id);
CREATE INDEX idx_inbound_order_items_part_id ON inbound_order_items(part_id);

/* ============================================================
   三、采退单主表
   ============================================================ */
CREATE TABLE IF NOT EXISTS purchase_return_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending','completed')),
  logistics_company TEXT,
  tracking_no TEXT,
  return_shipping_fee DECIMAL(10,2) DEFAULT 0,
  shipping_fee_payer TEXT CHECK (shipping_fee_payer IN ('supplier','self')),
  notes TEXT,
  operator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_purchase_return_orders_supplier_id ON purchase_return_orders(supplier_id);
CREATE INDEX idx_purchase_return_orders_created_at ON purchase_return_orders(created_at DESC);
CREATE INDEX idx_purchase_return_orders_return_no ON purchase_return_orders(return_no);

/* 采退单号生成触发器 */
CREATE OR REPLACE FUNCTION generate_return_order_no()
RETURNS TRIGGER AS $$
DECLARE
  seq_num INTEGER;
  today TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(return_no, '^CT-' || today || '-', ''), '')), '0')::INTEGER + 1
  INTO seq_num FROM purchase_return_orders WHERE return_no LIKE 'CT-' || today || '-%';
  NEW.return_no := 'CT-' || today || '-' || LPAD(seq_num::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_return_order_no ON purchase_return_orders;
CREATE TRIGGER set_return_order_no BEFORE INSERT ON purchase_return_orders
  FOR EACH ROW WHEN (NEW.return_no IS NULL) EXECUTE FUNCTION generate_return_order_no();

/* ============================================================
   四、采退单明细表
   ============================================================ */
CREATE TABLE IF NOT EXISTS purchase_return_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id UUID NOT NULL REFERENCES purchase_return_orders(id) ON DELETE CASCADE,
  supplier_return_record_id UUID REFERENCES supplier_return_records(id) ON DELETE SET NULL,
  part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
  part_number TEXT,
  name TEXT,
  brand TEXT,
  specification TEXT,
  quantity INTEGER NOT NULL,
  return_reason TEXT,
  unit_cost DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_purchase_return_order_items_order_id ON purchase_return_order_items(return_order_id);
CREATE INDEX idx_purchase_return_order_items_record_id ON purchase_return_order_items(supplier_return_record_id);
CREATE INDEX idx_purchase_return_order_items_part_id ON purchase_return_order_items(part_id);

/* ============================================================
   五、修改 supplier_return_records 增加采退单关联
   ============================================================ */
ALTER TABLE supplier_return_records
  ADD COLUMN IF NOT EXISTS return_order_id UUID REFERENCES purchase_return_orders(id) ON DELETE SET NULL;

CREATE INDEX idx_supplier_return_records_return_order_id ON supplier_return_records(return_order_id);

/* ============================================================
   六、RLS 策略（默认关闭，需手动开启）
   ============================================================ */
ALTER TABLE inbound_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_order_items ENABLE ROW LEVEL SECURITY;

/* 管理员可读写 */
CREATE POLICY inbound_orders_admin_all ON inbound_orders
  FOR ALL TO authenticated USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY inbound_order_items_admin_all ON inbound_order_items
  FOR ALL TO authenticated USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY purchase_return_orders_admin_all ON purchase_return_orders
  FOR ALL TO authenticated USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY purchase_return_order_items_admin_all ON purchase_return_order_items
  FOR ALL TO authenticated USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin')
  WITH CHECK (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

/* 所有登录用户可读 */
CREATE POLICY inbound_orders_read ON inbound_orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY inbound_order_items_read ON inbound_order_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY purchase_return_orders_read ON purchase_return_orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY purchase_return_order_items_read ON purchase_return_order_items
  FOR SELECT TO authenticated USING (true);

/* ============================================================
   七、扩展 supplier_transactions 关联单据
   ============================================================ */
ALTER TABLE supplier_transactions
  ADD COLUMN IF NOT EXISTS reference_id UUID,
  ADD COLUMN IF NOT EXISTS reference_type TEXT;
