/* 修复 employee_contacts 表
   原因：原始迁移 migrations_20260501_employee_contacts.sql 没在 Supabase 上执行，
         导致 PostgREST 返回 404；同时原迁移没写 RLS，登录用户也访问不到。
   该迁移幂等：创建表 + 索引 + RLS 策略，重复执行无副作用。 */

CREATE TABLE IF NOT EXISTS employee_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  relationship TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_contacts_profile ON employee_contacts(profile_id);

ALTER TABLE employee_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON employee_contacts;
CREATE POLICY "auth_full_access" ON employee_contacts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
