-- 汽修管家 - 采购订单模块新增表
-- 在 Supabase Studio SQL Editor 中执行

-- 1. 采购订单主表
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_no TEXT,
  supplier_id UUID REFERENCES suppliers(id),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'partial_received', 'fully_received', 'cancelled')),
  total_amount DECIMAL(12,2),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 采购订单明细表
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  part_id UUID REFERENCES parts(id),
  part_name_id UUID REFERENCES part_names(id),
  part_number TEXT,
  name TEXT,
  brand TEXT,
  specification TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost DECIMAL(10,2),
  received_qty INTEGER DEFAULT 0,
  work_order_item_part_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 补充外键约束（work_order_item_parts 定义在后）
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_work_order_item_part_id_fkey;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_work_order_item_part_id_fkey
  FOREIGN KEY (work_order_item_part_id) REFERENCES work_order_item_parts(id);

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_part ON purchase_order_items(part_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_work_order_part ON purchase_order_items(work_order_item_part_id);

-- 5. RLS
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
