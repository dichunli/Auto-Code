-- ============================================================
-- 员工档案完善 & 分组功能
-- ============================================================

-- ============================================================
-- 1. 员工分组/部门表
-- ============================================================
CREATE TABLE employee_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预置默认分组
INSERT INTO employee_groups (name, description, sort_order) VALUES
('维修部', '负责车辆维修、保养、质检', 1),
('接待部', '负责客户接待、工单开单、结算', 2),
('配件部', '负责配件采购、库存管理', 3),
('财务部', '负责收支管理、工资核算', 4),
('管理层', '负责门店运营、决策管理', 5),
('其他', '未分类人员', 99);

-- ============================================================
-- 2. 扩展员工档案字段
-- ============================================================
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

-- ============================================================
-- 3. 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active);

-- ============================================================
-- 4. 函数：创建用户后自动创建 profile（如果还没有的话）
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, is_active, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, '新用户'),
    TRUE,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 如果触发器已存在则先删除
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
