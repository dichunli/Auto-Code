-- ============================================================
-- 修复员工关联表的 RLS 策略
-- ============================================================

-- 1. employee_groups 表 RLS
ALTER TABLE employee_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_groups_select" ON employee_groups;
DROP POLICY IF EXISTS "employee_groups_insert" ON employee_groups;
DROP POLICY IF EXISTS "employee_groups_update" ON employee_groups;
DROP POLICY IF EXISTS "employee_groups_delete" ON employee_groups;

CREATE POLICY "employee_groups_select" ON employee_groups FOR SELECT USING (true);
CREATE POLICY "employee_groups_insert" ON employee_groups FOR INSERT WITH CHECK (true);
CREATE POLICY "employee_groups_update" ON employee_groups FOR UPDATE USING (true);
CREATE POLICY "employee_groups_delete" ON employee_groups FOR DELETE USING (true);

-- 2. mechanic_levels 表 RLS
ALTER TABLE mechanic_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mechanic_levels_select" ON mechanic_levels;
DROP POLICY IF EXISTS "mechanic_levels_insert" ON mechanic_levels;
DROP POLICY IF EXISTS "mechanic_levels_update" ON mechanic_levels;
DROP POLICY IF EXISTS "mechanic_levels_delete" ON mechanic_levels;

CREATE POLICY "mechanic_levels_select" ON mechanic_levels FOR SELECT USING (true);
CREATE POLICY "mechanic_levels_insert" ON mechanic_levels FOR INSERT WITH CHECK (true);
CREATE POLICY "mechanic_levels_update" ON mechanic_levels FOR UPDATE USING (true);
CREATE POLICY "mechanic_levels_delete" ON mechanic_levels FOR DELETE USING (true);

-- 3. roles 表 RLS
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select" ON roles;
DROP POLICY IF EXISTS "roles_insert" ON roles;
DROP POLICY IF EXISTS "roles_update" ON roles;
DROP POLICY IF EXISTS "roles_delete" ON roles;

CREATE POLICY "roles_select" ON roles FOR SELECT USING (true);
CREATE POLICY "roles_insert" ON roles FOR INSERT WITH CHECK (true);
CREATE POLICY "roles_update" ON roles FOR UPDATE USING (true);
CREATE POLICY "roles_delete" ON roles FOR DELETE USING (true);

-- 4. profile_roles 表 RLS
ALTER TABLE profile_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_roles_select" ON profile_roles;
DROP POLICY IF EXISTS "profile_roles_insert" ON profile_roles;
DROP POLICY IF EXISTS "profile_roles_update" ON profile_roles;
DROP POLICY IF EXISTS "profile_roles_delete" ON profile_roles;

CREATE POLICY "profile_roles_select" ON profile_roles FOR SELECT USING (true);
CREATE POLICY "profile_roles_insert" ON profile_roles FOR INSERT WITH CHECK (true);
CREATE POLICY "profile_roles_update" ON profile_roles FOR UPDATE USING (true);
CREATE POLICY "profile_roles_delete" ON profile_roles FOR DELETE USING (true);
