-- ============================================================
-- 修复员工档案关联表（分组、角色、技师等级）
-- ============================================================

-- 1. 员工分组表
CREATE TABLE IF NOT EXISTS employee_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO employee_groups (name, description, sort_order) VALUES
('维修部', '负责车辆维修、保养、质检', 1),
('接待部', '负责客户接待、工单开单、结算', 2),
('配件部', '负责配件采购、库存管理', 3),
('财务部', '负责收支管理、工资核算', 4),
('管理层', '负责门店运营、决策管理', 5),
('其他', '未分类人员', 99)
ON CONFLICT DO NOTHING;

-- 2. 技师等级表
CREATE TABLE IF NOT EXISTS mechanic_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  level_code TEXT UNIQUE,
  share_coefficient DECIMAL(3,2) DEFAULT 1.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO mechanic_levels (name, level_code, share_coefficient) VALUES
('初级技师', 'L1', 0.80),
('中级技师', 'L2', 1.00),
('高级技师', 'L3', 1.20),
('大师技师', 'L4', 1.50)
ON CONFLICT DO NOTHING;

-- 3. 角色表
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (name, label, permissions) VALUES
('admin', '管理员', ARRAY['*']),
('boss', '老板', ARRAY['report:view','report:profit','report:performance','dashboard:all']),
('receptionist', '接待员', ARRAY['work_order:create','work_order:quote','work_order:settle','work_order:deliver','customer:manage','vehicle:manage']),
('mechanic', '技师', ARRAY['work_order:diagnose','work_order:repair','work_order:quality_check']),
('warehouse', '库管', ARRAY['inventory:manage','inventory:in','inventory:out']),
('accountant', '财务', ARRAY['payment:manage','report:view','report:profit'])
ON CONFLICT DO NOTHING;

-- 4. 员工角色关联表
CREATE TABLE IF NOT EXISTS profile_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE(profile_id, role_id)
);

-- 5. 扩展 profiles 字段（如果还没有）
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES employee_groups(id),
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male','female','other')),
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS entry_date DATE,
  ADD COLUMN IF NOT EXISTS id_card TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 6. 索引
CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profile_roles_profile ON profile_roles(profile_id);

-- 7. 给 4 位技师默认分配「技师」角色（可选）
INSERT INTO profile_roles (profile_id, role_id)
SELECT p.id, r.id
FROM profiles p
CROSS JOIN (SELECT id FROM roles WHERE name = 'mechanic') r
WHERE p.full_name IN ('吴岩', '高磊', '迟惠友', '王烁迪')
  AND NOT EXISTS (
    SELECT 1 FROM profile_roles pr WHERE pr.profile_id = p.id AND pr.role_id = r.id
  );
