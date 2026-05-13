/* 汽修管家 - 外包服务单模块（订单+明细两层结构）
   设计要点：
   1. 每个工单只能有一个外包单（outsource_orders.work_order_id UNIQUE）
   2. 一个外包单可以包含多个工单项目（outsource_order_items）
   3. 外包对象只能是供应商（supplier_id NOT NULL）
   4. 每个工单项目最多在一个外包单中（outsource_order_items.work_order_item_id UNIQUE）
   5. 外包项目必须关联 service_items（service_item_id NOT NULL） */

-- 清理可能存在的旧结构
DROP TABLE IF EXISTS outsource_order_items CASCADE;
DROP TABLE IF EXISTS outsource_orders CASCADE;

-- 1. 外包服务单主表（订单级）
CREATE TABLE outsource_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_no TEXT NOT NULL UNIQUE,
  work_order_id UUID NOT NULL UNIQUE REFERENCES work_orders(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  total_amount DECIMAL(10,2) DEFAULT 0,
  is_paid BOOLEAN DEFAULT FALSE,
  payment_method TEXT CHECK (payment_method IN ('cash', 'wechat', 'alipay', 'bank_transfer')),
  paid_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'settled', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 外包服务单明细表（项目级）
CREATE TABLE outsource_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outsource_order_id UUID NOT NULL REFERENCES outsource_orders(id) ON DELETE CASCADE,
  work_order_item_id UUID NOT NULL UNIQUE REFERENCES work_order_items(id) ON DELETE CASCADE,
  service_item_id UUID NOT NULL REFERENCES service_items(id),
  service_name TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 索引
CREATE INDEX idx_outsource_orders_work_order ON outsource_orders(work_order_id);
CREATE INDEX idx_outsource_orders_supplier ON outsource_orders(supplier_id);
CREATE INDEX idx_outsource_orders_status ON outsource_orders(status);
CREATE INDEX idx_outsource_order_items_order ON outsource_order_items(outsource_order_id);
CREATE INDEX idx_outsource_order_items_service ON outsource_order_items(service_item_id);

-- 4. RLS
ALTER TABLE outsource_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE outsource_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read" ON outsource_orders FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON outsource_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON outsource_orders FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON outsource_orders FOR DELETE USING (true);

CREATE POLICY "Allow all read" ON outsource_order_items FOR SELECT USING (true);
CREATE POLICY "Allow all insert" ON outsource_order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update" ON outsource_order_items FOR UPDATE USING (true);
CREATE POLICY "Allow all delete" ON outsource_order_items FOR DELETE USING (true);
