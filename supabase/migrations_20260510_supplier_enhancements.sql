-- 供应商功能扩展迁移

-- 1. 扩展 suppliers 表字段
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS wechat_id TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS wechat_group_qr TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS wrong_shipment_count INTEGER DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS quality_return_count INTEGER DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS recommendation_level INTEGER DEFAULT 0;
-- 0=不推荐, 1-5=推荐等级（1星到5星）

-- 2. 供应商联系人表
CREATE TABLE IF NOT EXISTS supplier_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  title TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);

-- 3. 供应商关联配件分类
CREATE TABLE IF NOT EXISTS supplier_part_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  part_category_id UUID NOT NULL REFERENCES part_categories(id) ON DELETE CASCADE,
  UNIQUE(supplier_id, part_category_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_part_categories_supplier ON supplier_part_categories(supplier_id);

-- 4. 供应商关联配件名称
CREATE TABLE IF NOT EXISTS supplier_part_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  part_name_id UUID NOT NULL REFERENCES part_names(id) ON DELETE CASCADE,
  UNIQUE(supplier_id, part_name_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_part_names_supplier ON supplier_part_names(supplier_id);

-- 5. 供应商关联配件品牌
CREATE TABLE IF NOT EXISTS supplier_part_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  part_brand_id UUID NOT NULL REFERENCES part_brands(id) ON DELETE CASCADE,
  UNIQUE(supplier_id, part_brand_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_part_brands_supplier ON supplier_part_brands(supplier_id);

-- 6. 供应商关联车型
CREATE TABLE IF NOT EXISTS supplier_vehicle_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  vehicle_model_id INTEGER NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  UNIQUE(supplier_id, vehicle_model_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_vehicle_models_supplier ON supplier_vehicle_models(supplier_id);

-- 7. 供应商往来款项
CREATE TABLE IF NOT EXISTS supplier_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('payment', 'refund', 'credit', 'debit')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON supplier_transactions(supplier_id);

-- 7. 扩展退货原因约束（添加质量返货）
-- 先移除旧约束再添加新约束（如果存在）
ALTER TABLE supplier_return_records DROP CONSTRAINT IF EXISTS supplier_return_records_return_reason_check;
ALTER TABLE supplier_return_records ADD CONSTRAINT supplier_return_records_return_reason_check
  CHECK (return_reason IN ('wrong_ship', 'excess', 'damaged', 'cancel', 'quality'));

-- RLS 策略
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_part_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_part_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_vehicle_models ENABLE ROW LEVEL SECURITY;

-- 允许所有读取
DROP POLICY IF EXISTS "Allow all read" ON supplier_contacts;
CREATE POLICY "Allow all read" ON supplier_contacts FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_part_categories;
CREATE POLICY "Allow all read" ON supplier_part_categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_part_names;
CREATE POLICY "Allow all read" ON supplier_part_names FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_part_brands;
CREATE POLICY "Allow all read" ON supplier_part_brands FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_transactions;
CREATE POLICY "Allow all read" ON supplier_transactions FOR SELECT USING (true);

-- 允许所有插入
DROP POLICY IF EXISTS "Allow all insert" ON supplier_contacts;
CREATE POLICY "Allow all insert" ON supplier_contacts FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all insert" ON supplier_part_categories;
CREATE POLICY "Allow all insert" ON supplier_part_categories FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all insert" ON supplier_part_names;
CREATE POLICY "Allow all insert" ON supplier_part_names FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all insert" ON supplier_part_brands;
CREATE POLICY "Allow all insert" ON supplier_part_brands FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all insert" ON supplier_transactions;
CREATE POLICY "Allow all insert" ON supplier_transactions FOR INSERT WITH CHECK (true);

-- 允许所有更新
DROP POLICY IF EXISTS "Allow all update" ON supplier_contacts;
CREATE POLICY "Allow all update" ON supplier_contacts FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow all update" ON supplier_part_categories;
CREATE POLICY "Allow all update" ON supplier_part_categories FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow all update" ON supplier_part_names;
CREATE POLICY "Allow all update" ON supplier_part_names FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow all update" ON supplier_part_brands;
CREATE POLICY "Allow all update" ON supplier_part_brands FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow all update" ON supplier_transactions;
CREATE POLICY "Allow all update" ON supplier_transactions FOR UPDATE USING (true);

-- 允许所有删除
DROP POLICY IF EXISTS "Allow all delete" ON supplier_contacts;
CREATE POLICY "Allow all delete" ON supplier_contacts FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow all delete" ON supplier_part_categories;
CREATE POLICY "Allow all delete" ON supplier_part_categories FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow all delete" ON supplier_part_names;
CREATE POLICY "Allow all delete" ON supplier_part_names FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow all delete" ON supplier_part_brands;
CREATE POLICY "Allow all delete" ON supplier_part_brands FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow all delete" ON supplier_transactions;
CREATE POLICY "Allow all delete" ON supplier_transactions FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow all read" ON supplier_vehicle_models;
CREATE POLICY "Allow all read" ON supplier_vehicle_models FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all insert" ON supplier_vehicle_models;
CREATE POLICY "Allow all insert" ON supplier_vehicle_models FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all update" ON supplier_vehicle_models;
CREATE POLICY "Allow all update" ON supplier_vehicle_models FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow all delete" ON supplier_vehicle_models;
CREATE POLICY "Allow all delete" ON supplier_vehicle_models FOR DELETE USING (true);
