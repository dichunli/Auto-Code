-- 车型库 RLS 修复（如果表已存在但无策略）
ALTER TABLE vehicle_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_full_access" ON vehicle_models;
CREATE POLICY "auth_full_access" ON vehicle_models FOR ALL TO authenticated USING (true) WITH CHECK (true);
