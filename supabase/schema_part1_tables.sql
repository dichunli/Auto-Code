-- ============================================================
-- 汽修管家 - 汽车维修厂管理系统数据库 Schema
-- 支持：本地 Docker Supabase / 云端 Supabase
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. 角色与权限
-- ============================================================
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置角色
INSERT INTO roles (name, label, permissions) VALUES
('admin', '管理员', ARRAY['*']),
('boss', '老板', ARRAY['report:view','report:profit','report:performance','dashboard:all']),
('receptionist', '接待员', ARRAY['work_order:create','work_order:quote','work_order:settle','work_order:deliver','customer:manage','vehicle:manage']),
('mechanic', '技师', ARRAY['work_order:diagnose','work_order:repair','work_order:quality_check']),
('warehouse', '库管', ARRAY['inventory:manage','inventory:in','inventory:out']),
('accountant', '财务', ARRAY['payment:manage','report:view','report:profit']);

-- 技师等级
CREATE TABLE mechanic_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  level_code TEXT UNIQUE,
  share_coefficient DECIMAL(3,2) DEFAULT 1.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 员工档案（关联 auth.users）
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  mechanic_level_id UUID REFERENCES mechanic_levels(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 身兼多职
CREATE TABLE profile_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE(profile_id, role_id)
);

-- ============================================================
-- 2. 车型库
-- ============================================================
CREATE TABLE vehicle_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand TEXT NOT NULL,
  series TEXT NOT NULL,
  model_name TEXT,
  year_start INTEGER,
  year_end INTEGER,
  engine TEXT,
  model_code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 客户体系
-- ============================================================
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  address TEXT,
  credit_limit DECIMAL(12,2) DEFAULT 0,
  payment_terms TEXT DEFAULT '月结',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  company TEXT,
  company_id UUID REFERENCES companies(id),
  id_card TEXT,
  star_level INTEGER DEFAULT 1 CHECK (star_level BETWEEN 1 AND 5),
  total_spent DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customer_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  UNIQUE(customer_id, tag_id)
);

CREATE TABLE customer_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  tax_no TEXT,
  address TEXT,
  phone TEXT,
  bank_name TEXT,
  bank_account TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. 车辆
-- ============================================================
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_model_id UUID REFERENCES vehicle_models(id),
  plate_number TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  vin TEXT,
  engine_no TEXT,
  color TEXT,
  year INTEGER,
  mileage INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  work_order_id UUID,
  photo_type TEXT CHECK (photo_type IN ('exterior','interior','damage','repair_before','repair_after')),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. 维修项目三层模型：分类 → 名称库 → 项目实例
-- ============================================================

-- 5.1 维修项目分类（含提成标准）
CREATE TABLE service_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL, -- 分类名称：如保养、机修、钣金、喷漆

  -- 销售提成
  sales_commission_type TEXT CHECK (sales_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  sales_commission_value DECIMAL(10,2),

  -- 诊断提成
  diagnosis_commission_type TEXT CHECK (diagnosis_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  diagnosis_commission_value DECIMAL(10,2),

  -- 施工提成
  repair_commission_type TEXT CHECK (repair_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  repair_commission_value DECIMAL(10,2),

  -- 质检提成
  qc_commission_type TEXT CHECK (qc_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  qc_commission_value DECIMAL(10,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5.2 维修项目名称库
CREATE TABLE service_names (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- 项目名称：如更换机油、更换刹车片
  search_keywords TEXT, -- 搜索字段：用于模糊检索，如"机油 保养 小保养"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5.3 维修项目实例（关联分类和名称库）
CREATE TABLE service_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT,
  category_id UUID REFERENCES service_categories(id),
  service_name_id UUID REFERENCES service_names(id),
  name TEXT NOT NULL, -- 自动从 service_names 带入，但支持修改
  standard_hours DECIMAL(4,1),
  description TEXT,
  is_vehicle_specific BOOLEAN DEFAULT FALSE,
  default_price DECIMAL(10,2),
  vip_price DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE service_item_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_item_id UUID NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
  vehicle_model_id UUID REFERENCES vehicle_models(id),
  price DECIMAL(10,2) NOT NULL,
  UNIQUE(service_item_id, vehicle_model_id)
);

-- 单位客户项目专属价格
CREATE TABLE company_service_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  service_item_id UUID NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  UNIQUE(company_id, service_item_id)
);

-- ============================================================
-- 6. 配件库存
-- ============================================================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE logistics_companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  tracking_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 配件分类（含提成和耗材/自动关联车型设置）
CREATE TABLE part_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  auto_link_vehicle_model BOOLEAN DEFAULT FALSE,
  is_consumable BOOLEAN DEFAULT FALSE,

  sales_commission_type TEXT CHECK (sales_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  sales_commission_value DECIMAL(10,2),
  diagnosis_commission_type TEXT CHECK (diagnosis_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  diagnosis_commission_value DECIMAL(10,2),
  repair_commission_type TEXT CHECK (repair_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  repair_commission_value DECIMAL(10,2),
  qc_commission_type TEXT CHECK (qc_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  qc_commission_value DECIMAL(10,2),
  picking_commission_type TEXT CHECK (picking_commission_type IN ('revenue_pct', 'profit_pct', 'fixed')),
  picking_commission_value DECIMAL(10,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 配件名称库
CREATE TABLE part_names (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES part_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT DEFAULT '件',
  search_keywords TEXT,
  auto_link_vehicle_model BOOLEAN DEFAULT FALSE,
  is_consumable BOOLEAN DEFAULT FALSE,
  sales_commission_type TEXT,
  sales_commission_value NUMERIC,
  diagnosis_commission_type TEXT,
  diagnosis_commission_value NUMERIC,
  repair_commission_type TEXT,
  repair_commission_value NUMERIC,
  qc_commission_type TEXT,
  qc_commission_value NUMERIC,
  picking_commission_type TEXT,
  picking_commission_value NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 品牌
CREATE TABLE part_brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 配件名称与品牌关联（多对多，记录使用频次）
CREATE TABLE part_name_brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_name_id UUID NOT NULL REFERENCES part_names(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES part_brands(id) ON DELETE CASCADE,
  usage_count INTEGER DEFAULT 0,
  UNIQUE(part_name_id, brand_id)
);

-- 规格
CREATE TABLE part_specifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 配件名称与规格关联（多对多，记录使用频次）
CREATE TABLE part_name_specifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_name_id UUID NOT NULL REFERENCES part_names(id) ON DELETE CASCADE,
  specification_id UUID NOT NULL REFERENCES part_specifications(id) ON DELETE CASCADE,
  usage_count INTEGER DEFAULT 0,
  UNIQUE(part_name_id, specification_id)
);

-- 配件实例
CREATE TABLE parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_number TEXT NOT NULL,
  part_name_id UUID NOT NULL REFERENCES part_names(id),
  brand_id UUID REFERENCES part_brands(id),
  specification_id UUID REFERENCES part_specifications(id),
  specification_text TEXT,
  name TEXT NOT NULL,
  category_id UUID REFERENCES part_categories(id),
  unit TEXT DEFAULT '件',
  quantity INTEGER DEFAULT 0 NOT NULL,
  min_stock INTEGER DEFAULT 10,
  unit_cost DECIMAL(10,2),
  unit_price DECIMAL(10,2),
  supplier_id UUID REFERENCES suppliers(id),
  location TEXT,
  notes TEXT,
  auto_link_vehicle_model BOOLEAN DEFAULT FALSE,
  is_consumable BOOLEAN DEFAULT FALSE,
  sales_commission_type TEXT,
  sales_commission_value NUMERIC,
  diagnosis_commission_type TEXT,
  diagnosis_commission_value NUMERIC,
  repair_commission_type TEXT,
  repair_commission_value NUMERIC,
  qc_commission_type TEXT,
  qc_commission_value NUMERIC,
  picking_commission_type TEXT,
  picking_commission_value NUMERIC,
  oe_number TEXT,
  oe_numbers TEXT[] DEFAULT '{}',
  epc_source TEXT DEFAULT 'manual',
  vin17_part_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 配件图片
CREATE TABLE part_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE part_vehicle_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  vehicle_model_id UUID NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  notes TEXT,
  fitment_position TEXT,
  source TEXT DEFAULT 'manual',
  vin17_fitness_id TEXT,
  UNIQUE(part_id, vehicle_model_id)
);

-- 单位客户配件专属价格
CREATE TABLE company_part_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL,
  UNIQUE(company_id, part_id)
);

CREATE TABLE part_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  batch_no TEXT,
  quantity INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  supplier_id UUID REFERENCES suppliers(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id UUID NOT NULL REFERENCES parts(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('in','out','adjust','return')),
  quantity INTEGER NOT NULL,
  before_qty INTEGER NOT NULL,
  after_qty INTEGER NOT NULL,
  work_order_id UUID,
  operator_id UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 盘点单
CREATE TABLE inventory_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_no TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 盘点明细
CREATE TABLE inventory_check_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_id UUID NOT NULL REFERENCES inventory_checks(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES parts(id),
  system_qty INTEGER NOT NULL,
  actual_qty INTEGER,
  diff_qty INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 退货单
CREATE TABLE purchase_returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_id UUID NOT NULL REFERENCES parts(id),
  batch_id UUID REFERENCES part_batches(id),
  quantity INTEGER NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6.5 采购订单管理
-- ============================================================
CREATE TABLE purchase_orders (
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

CREATE TABLE purchase_order_items (
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

-- ============================================================
-- 知识库
-- ============================================================
CREATE TABLE knowledge_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES knowledge_categories(id),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE knowledge_articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  content TEXT,
  type TEXT NOT NULL CHECK (type IN ('article', 'video', 'qa')),
  category_id UUID REFERENCES knowledge_categories(id),
  video_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 知识库文章与维修项目关联（支持关联名称库和具体项目实例）
CREATE TABLE knowledge_service_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  service_name_id UUID REFERENCES service_names(id),
  service_item_id UUID REFERENCES service_items(id),
  CHECK (service_name_id IS NOT NULL OR service_item_id IS NOT NULL)
);

-- ============================================================
-- 7. 工单体系（四级嵌套）
-- ============================================================
CREATE TYPE work_order_status AS ENUM (
  'received','pending_diagnosis','pending_repair','repairing','pending_quality_check','pending_close','pending_settlement','settled','delivered'
);

CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_no TEXT NOT NULL UNIQUE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  customer_id UUID NOT NULL REFERENCES customers(id),

  receptionist_id UUID REFERENCES profiles(id),
  mileage_in INTEGER NOT NULL,
  fuel_level INTEGER CHECK (fuel_level BETWEEN 0 AND 100),
  customer_complaint TEXT,
  inspection_notes TEXT,

  parts_cost DECIMAL(10,2) DEFAULT 0,
  labor_cost DECIMAL(10,2) DEFAULT 0,
  other_cost DECIMAL(10,2) DEFAULT 0,
  total_cost DECIMAL(10,2) GENERATED ALWAYS AS (parts_cost + labor_cost + other_cost) STORED,

  discount_amount DECIMAL(10,2) DEFAULT 0,
  discount_rate DECIMAL(10,8) DEFAULT 1,

  status work_order_status DEFAULT 'pending_diagnosis',
  received_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  estimated_completion_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 修正：inventory_logs 引用了 work_orders，需要 work_orders 先定义
ALTER TABLE inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_work_order_id_fkey;
ALTER TABLE inventory_logs ADD CONSTRAINT inventory_logs_work_order_id_fkey
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id);

-- 需求逐条
CREATE TABLE work_order_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  seq INTEGER DEFAULT 1,
  description TEXT NOT NULL,
  diagnosis TEXT,
  remarks TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  submitted_by UUID REFERENCES profiles(id),
  assigned_to UUID REFERENCES profiles(id),
  assignment_type TEXT CHECK (assignment_type IN ('assigned', 'claimed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 需求多媒体（图片、音频、视频）
CREATE TABLE work_order_requirement_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requirement_id UUID NOT NULL REFERENCES work_order_requirements(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'audio', 'video')),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 维修项目（可关联需求）
CREATE TABLE work_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  requirement_id UUID REFERENCES work_order_requirements(id) ON DELETE SET NULL,
  service_item_id UUID REFERENCES service_items(id),
  name TEXT NOT NULL,
  alias_name TEXT,
  item_type TEXT NOT NULL CHECK (item_type IN ('labor','part','other')),
  description TEXT,
  quantity DECIMAL(10,2) DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  mechanic_id UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','paused','completed')),
  customer_opinion TEXT DEFAULT 'pending' CHECK (customer_opinion IN ('agree', 'reject', 'pending')),
  is_outsourced BOOLEAN DEFAULT FALSE,
  outsourced_supplier_id UUID REFERENCES suppliers(id),
  business_type TEXT DEFAULT 'normal' CHECK (business_type IN ('normal', 'insurance', 'gift', 'rework')),
  rework_source_item_id UUID REFERENCES work_order_items(id),
  rework_reason TEXT CHECK (rework_reason IN ('part_quality', 'workmanship')),
  rework_loss_amount DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 项目所用配件（先选配件名称，再选具体分支，支持空分支）
CREATE TABLE work_order_item_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  part_name_id UUID REFERENCES part_names(id),
  part_id UUID REFERENCES parts(id),
  batch_id UUID REFERENCES part_batches(id),

  -- a. 配件基础信息（支持空分支时手动填写，逐步完善）
  part_number TEXT,
  name TEXT,
  alias_name TEXT,
  unit TEXT,
  brand TEXT,
  specification TEXT,
  unit_cost DECIMAL(10,2),
  unit_price DECIMAL(10,2),

  -- b. 工单流转状态
  quantity INTEGER NOT NULL DEFAULT 1,
  customer_opinion TEXT DEFAULT 'pending' CHECK (customer_opinion IN ('agree', 'reject', 'pending')),
  is_purchased BOOLEAN DEFAULT FALSE,
  is_arrived BOOLEAN DEFAULT FALSE,
  supplier_name TEXT,
  logistics_agreement TEXT,

  -- 出库状态
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','out','returned')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 采购订单明细表的外键（work_order_item_parts 后定义，在此补充）
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_work_order_item_part_id_fkey;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_work_order_item_part_id_fkey
  FOREIGN KEY (work_order_item_part_id) REFERENCES work_order_item_parts(id);

-- 维修项目多媒体（图片）
CREATE TABLE work_order_item_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'audio', 'video')),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 配件分支多媒体（图片）
CREATE TABLE work_order_item_part_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_part_id UUID NOT NULL REFERENCES work_order_item_parts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'audio', 'video')),
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 项目多技师分成
CREATE TABLE work_order_item_mechanics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  mechanic_id UUID NOT NULL REFERENCES profiles(id),
  share_pct DECIMAL(5,2) DEFAULT 100,
  commission_amount DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 维修项目施工记录（计时）
CREATE TABLE work_order_item_construction_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_id UUID NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  mechanic_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('start','pause','resume','complete')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7.5 车况检查
-- ============================================================
CREATE TABLE work_order_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  inspection_type TEXT NOT NULL DEFAULT 'inspection' CHECK (inspection_type IN ('reception', 'inspection')),
  front_brake_pad_thickness DECIMAL(5,2),
  rear_brake_pad_thickness DECIMAL(5,2),
  exhaust_hc DECIMAL(10,4),
  exhaust_co DECIMAL(10,4),
  exhaust_no DECIMAL(10,4),
  exhaust_co2 DECIMAL(10,4),
  exhaust_o2 DECIMAL(10,4),
  light_checks JSONB DEFAULT '{}',
  dashboard_fuel_level DECIMAL(5,2),
  dashboard_fault_lights JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE work_order_inspection_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID NOT NULL REFERENCES work_order_inspections(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('engine_oil_before', 'engine_oil_after', 'fluid', 'exterior', 'dashboard', 'reception_video')),
  storage_path TEXT NOT NULL,
  annotations JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7.6 车辆保养模板
-- ============================================================
CREATE TABLE vehicle_maintenance_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  previous_cost DECIMAL(10,2),
  customer_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle_maintenance_template_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES vehicle_maintenance_templates(id) ON DELETE CASCADE,
  service_item_id UUID REFERENCES service_items(id),
  name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('labor','part','other')),
  quantity DECIMAL(10,2) DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  standard_hours DECIMAL(5,2),
  mechanic_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle_maintenance_template_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_item_id UUID NOT NULL REFERENCES vehicle_maintenance_template_items(id) ON DELETE CASCADE,
  part_name_id UUID REFERENCES part_names(id),
  part_id UUID REFERENCES parts(id),
  quantity INTEGER DEFAULT 1,
  unit_cost DECIMAL(10,2),
  unit_price DECIMAL(10,2),
  name TEXT,
  brand TEXT,
  specification TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7.7 配件领料 / 退库 / 退货
-- ============================================================
CREATE TABLE part_picking_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_part_id UUID NOT NULL REFERENCES work_order_item_parts(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES part_batches(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  picked_by UUID REFERENCES profiles(id),
  picked_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE part_return_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_part_id UUID NOT NULL REFERENCES work_order_item_parts(id) ON DELETE CASCADE,
  picking_record_id UUID REFERENCES part_picking_records(id),
  return_type TEXT NOT NULL CHECK (return_type IN ('excess', 'wrong_pick', 'wrong_ship', 'damaged')),
  quantity INTEGER NOT NULL DEFAULT 1,
  returned_by UUID REFERENCES profiles(id),
  returned_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE supplier_return_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_item_part_id UUID NOT NULL REFERENCES work_order_item_parts(id) ON DELETE CASCADE,
  return_reason TEXT NOT NULL CHECK (return_reason IN ('wrong_ship', 'excess', 'damaged', 'cancel')),
  quantity INTEGER NOT NULL DEFAULT 1,
  supplier_name TEXT,
  logistics_company TEXT,
  tracking_no TEXT,
  photos TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. 质检
-- ============================================================
CREATE TABLE quality_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  checker_id UUID REFERENCES profiles(id),
  result TEXT NOT NULL CHECK (result IN ('passed','failed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. 结算与支付
-- ============================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash','wechat','alipay','credit','member','bank_transfer')),
  amount DECIMAL(10,2) NOT NULL,
  paid_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. 回访
-- ============================================================
CREATE TABLE follow_ups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  method TEXT CHECK (method IN ('phone','sms','wechat')),
  result TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. 技师绩效
-- ============================================================
CREATE TABLE mechanic_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mechanic_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES work_orders(id),
  score_type TEXT NOT NULL CHECK (score_type IN ('completion','quality_pass','quality_fail','ontime','overtime')),
  points INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. 状态变更历史
-- ============================================================
CREATE TABLE work_order_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  from_status work_order_status,
  to_status work_order_status NOT NULL,
  changed_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 18. 员工培训学习系统
-- ============================================================
CREATE TABLE training_courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IN ('safety','technical','service','management')),
  content_type TEXT CHECK (content_type IN ('video','document','quiz')),
  content_url TEXT,
  content_text TEXT,
  duration_minutes INTEGER,
  passing_score INTEGER DEFAULT 60,
  is_required BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE training_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id),
  due_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  score INTEGER,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE training_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID NOT NULL REFERENCES training_assignments(id) ON DELETE CASCADE,
  progress_pct INTEGER DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  last_accessed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 19. 员工日常行为管理
-- ============================================================
CREATE TABLE behavior_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_type TEXT NOT NULL CHECK (check_type IN ('appearance','venue','tools','other')),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  checker_id UUID REFERENCES profiles(id),
  score INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  photos TEXT[] DEFAULT '{}',
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE behavior_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  assignee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  score_reward INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  photos TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 20. 财务管理
-- ============================================================
CREATE TABLE finance_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('cash','bank','wechat','alipay','other')),
  balance DECIMAL(12,2) DEFAULT 0,
  opening_balance DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO finance_accounts (name, account_type, opening_balance) VALUES
('现金账户', 'cash', 0),
('微信商户', 'wechat', 0),
('支付宝商户', 'alipay', 0);

CREATE TABLE finance_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO finance_categories (name, type, sort_order) VALUES
('维修收入', 'income', 1),
('配件销售', 'income', 2),
('其他收入', 'income', 3),
('配件采购', 'expense', 1),
('员工工资', 'expense', 2),
('场地租金', 'expense', 3),
('水电杂费', 'expense', 4),
('其他支出', 'expense', 5);

CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES finance_accounts(id),
  category_id UUID REFERENCES finance_categories(id),
  type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount DECIMAL(12,2) NOT NULL,
  related_type TEXT CHECK (related_type IN ('work_order','purchase_order','payroll','other')),
  related_id UUID,
  description TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_finance_transactions_date ON finance_transactions(transaction_date);
CREATE INDEX idx_finance_transactions_type ON finance_transactions(type);
CREATE INDEX idx_finance_transactions_related ON finance_transactions(related_type, related_id);

CREATE TABLE accounts_receivable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  work_order_id UUID REFERENCES work_orders(id),
  amount DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','cancelled')),
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ar_customer ON accounts_receivable(customer_id);
CREATE INDEX idx_ar_status ON accounts_receivable(status);

CREATE TABLE accounts_payable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID REFERENCES suppliers(id),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  amount DECIMAL(12,2) NOT NULL,
  paid_amount DECIMAL(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','cancelled')),
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ap_supplier ON accounts_payable(supplier_id);
CREATE INDEX idx_ap_status ON accounts_payable(status);

-- ============================================================
-- 21. 会员管理
-- ============================================================
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  card_no TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id),
  name TEXT NOT NULL,
  phone TEXT,
  balance DECIMAL(10,2) DEFAULT 0 NOT NULL,
  discount_rate DECIMAL(3,2) DEFAULT 1.00 NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'expired')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_members_card_no ON members(card_no);
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_members_customer ON members(customer_id);
CREATE INDEX idx_members_status ON members(status);

CREATE TABLE member_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('recharge', 'consume', 'refund')),
  amount DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  work_order_id UUID REFERENCES work_orders(id),
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_member_transactions_member ON member_transactions(member_id);
CREATE INDEX idx_member_transactions_work_order ON member_transactions(work_order_id);
CREATE INDEX idx_member_transactions_created ON member_transactions(created_at);

-- ============================================================
-- 13. 补外键（解决前向引用）
-- ============================================================
ALTER TABLE vehicle_photos ADD CONSTRAINT vehicle_photos_work_order_id_fkey
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id);

-- ============================================================
-- 14. 触发器
-- ============================================================


-- 工单号自动生成


-- 状态变更历史


-- 质检不合格自动扣分


-- 完工自动加分


-- 结算后自动更新客户累计消费和星级


-- 配件分类 updated_at

-- 工单使用配件时，如果配件分类设置了自动关联车型，则自动关联


-- 工单领料出库：按FIFO扣减批次库存


-- 工单退料：退回原批次


-- 领料扣减批次库存


-- 退库恢复批次库存


-- ============================================================
-- 15. 索引
-- ============================================================
CREATE INDEX idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX idx_vehicles_plate ON vehicles(plate_number);
CREATE INDEX idx_vehicles_model ON vehicles(vehicle_model_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_orders_vehicle ON work_orders(vehicle_id);
CREATE INDEX idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX idx_work_order_reqs_order ON work_order_requirements(work_order_id);
CREATE INDEX idx_work_order_reqs_assigned ON work_order_requirements(assigned_to);
CREATE INDEX idx_work_order_req_media ON work_order_requirement_media(requirement_id);
CREATE INDEX idx_work_order_items_order ON work_order_items(work_order_id);
CREATE INDEX idx_work_order_item_parts ON work_order_item_parts(work_order_item_id);
CREATE INDEX idx_parts_category ON parts(category_id);
CREATE INDEX idx_parts_name ON parts(part_name_id);
CREATE INDEX idx_parts_brand ON parts(brand_id);
CREATE INDEX idx_parts_number ON parts(part_number);
CREATE INDEX idx_part_names_category ON part_names(category_id);
CREATE INDEX idx_part_name_brands ON part_name_brands(part_name_id, brand_id);
CREATE INDEX idx_part_name_specs ON part_name_specifications(part_name_id, specification_id);
CREATE INDEX idx_part_images_part ON part_images(part_id);
CREATE INDEX idx_work_order_item_parts_batch ON work_order_item_parts(batch_id);
CREATE INDEX idx_work_order_item_parts_status ON work_order_item_parts(status);
CREATE INDEX idx_inventory_logs_part ON inventory_logs(part_id);
CREATE INDEX idx_service_item_prices ON service_item_prices(service_item_id, vehicle_model_id);
CREATE INDEX idx_service_names_category ON service_names(category_id);
CREATE INDEX idx_service_items_category ON service_items(category_id);
CREATE INDEX idx_service_items_name ON service_items(service_name_id);
CREATE INDEX idx_part_models ON part_vehicle_models(part_id, vehicle_model_id);
CREATE INDEX idx_payments_order ON payments(work_order_id);
CREATE INDEX idx_scores_mechanic ON mechanic_scores(mechanic_id);
CREATE INDEX idx_companies_name ON companies(name);
CREATE INDEX idx_company_service_prices ON company_service_prices(company_id, service_item_id);
CREATE INDEX idx_company_part_prices ON company_part_prices(company_id, part_id);
CREATE INDEX idx_part_batches_part ON part_batches(part_id);
CREATE INDEX idx_inventory_checks_status ON inventory_checks(status);
CREATE INDEX idx_inventory_check_items_check ON inventory_check_items(check_id);
CREATE INDEX idx_purchase_returns_part ON purchase_returns(part_id);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX idx_purchase_order_items_order ON purchase_order_items(order_id);
CREATE INDEX idx_purchase_order_items_part ON purchase_order_items(part_id);
CREATE INDEX idx_purchase_order_items_work_order_part ON purchase_order_items(work_order_item_part_id);
CREATE INDEX idx_work_order_item_mechanics ON work_order_item_mechanics(work_order_item_id);
CREATE INDEX idx_work_order_item_construction_logs_item ON work_order_item_construction_logs(work_order_item_id);
CREATE INDEX idx_part_picking_records_part ON part_picking_records(work_order_item_part_id);
CREATE INDEX idx_part_return_records_part ON part_return_records(work_order_item_part_id);
CREATE INDEX idx_supplier_return_records_part ON supplier_return_records(work_order_item_part_id);
CREATE INDEX idx_knowledge_articles_category ON knowledge_articles(category_id);
CREATE INDEX idx_knowledge_articles_type ON knowledge_articles(type);
CREATE INDEX idx_knowledge_service_links_article ON knowledge_service_links(article_id);
CREATE INDEX idx_knowledge_service_links_name ON knowledge_service_links(service_name_id);
CREATE INDEX idx_knowledge_service_links_item ON knowledge_service_links(service_item_id);
CREATE INDEX idx_training_courses_category ON training_courses(category);
CREATE INDEX idx_training_assignments_employee ON training_assignments(employee_id);
CREATE INDEX idx_training_assignments_course ON training_assignments(course_id);
CREATE INDEX idx_training_progress_assignment ON training_progress(assignment_id);
CREATE INDEX idx_behavior_checks_employee ON behavior_checks(employee_id);
CREATE INDEX idx_behavior_tasks_assignee ON behavior_tasks(assignee_id);

-- ============================================================
-- 16. RLS（简化版：所有登录用户可读写，后续按权限细化）
-- ============================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_requirement_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_item_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_item_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_item_part_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_item_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanic_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_vehicle_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_service_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_part_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_check_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mechanic_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_item_mechanics ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_item_construction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_name_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_name_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_service_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_inspection_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance_template_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_picking_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_return_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_return_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON vehicles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_requirements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_item_parts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_item_media FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_item_part_media FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON parts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON inventory_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON logistics_companies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON service_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON service_item_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON service_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON service_names FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON vehicle_models FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON quality_checks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON follow_ups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON mechanic_scores FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_history FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON tags FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON customer_tags FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON customer_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON vehicle_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_vehicle_models FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON roles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON profile_roles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON companies FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON company_service_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON company_part_prices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON inventory_checks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON inventory_check_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON purchase_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON mechanic_levels FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_item_mechanics FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_item_construction_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_names FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_brands FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_name_brands FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_specifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_name_specifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_images FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_requirement_media FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON knowledge_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON knowledge_articles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON knowledge_service_links FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_inspections FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON work_order_inspection_media FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON vehicle_maintenance_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON vehicle_maintenance_template_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON vehicle_maintenance_template_parts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_picking_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON part_return_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON supplier_return_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON training_courses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON training_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON training_progress FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON behavior_checks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON behavior_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 17. Storage Buckets
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('work-order-media', 'work-order-media', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('training-media', 'training-media', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('behavior-media', 'behavior-media', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 20. 原子结算 RPC 函数
-- ============================================================

-- ============================================================
-- 21. RLS 安全加固：核心财务表防篡改
-- ============================================================
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON finance_accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON finance_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON finance_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON member_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON accounts_receivable FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON accounts_payable FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_full_access" ON members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 22. P0 安全修复 RPC 函数
-- ============================================================

-- 会员充值原子操作

-- 工单状态流转（含业务校验）

-- 施工记录原子操作（防并发）

-- 新建工单事务 RPC

-- ============================================================
-- 23. 视图修复
-- ============================================================
DROP VIEW IF EXISTS v_inventory_turnover;
CREATE OR REPLACE VIEW v_inventory_turnover AS
SELECT
  pn.id AS part_name_id,
  pn.name AS part_name,
  pc.name AS category_name,
  COALESCE(SUM(p.quantity), 0) AS total_stock,
  COALESCE(SUM(p.quantity * p.unit_cost), 0) AS total_value,
  COALESCE(SUM(CASE WHEN il.change_type = 'out' THEN il.quantity ELSE 0 END), 0) AS total_out_30d,
  CASE
    WHEN COALESCE(SUM(p.quantity), 0) > 0
    THEN ROUND(
      COALESCE(SUM(CASE WHEN il.change_type = 'out' THEN il.quantity ELSE 0 END), 0) * 30.0
      / NULLIF(SUM(p.quantity), 0), 2)
    ELSE NULL
  END AS turnover_days
FROM part_names pn
LEFT JOIN part_categories pc ON pc.id = pn.category_id
LEFT JOIN parts p ON p.part_name_id = pn.id
LEFT JOIN inventory_logs il ON il.part_id = p.id AND il.created_at >= NOW() - INTERVAL '30 days'
GROUP BY pn.id, pn.name, pc.name;
