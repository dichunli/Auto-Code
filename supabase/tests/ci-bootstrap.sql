/* ============================================================
 * CI 裸 Postgres 垫片：模拟 Supabase 本地环境的最小集合
 *
 * 为什么需要这个文件：
 *   项目的迁移文件是在 Supabase 环境（托管/本地 CLI）上写的，
 *   引用了 Supabase 平台自带的角色、auth/storage schema 和扩展。
 *   GitHub Actions 的 postgres 服务是裸库，必须先垫上这些东西，
 *   迁移才能按原样重放。
 *
 * 垫片内容：
 *   1. 角色 anon / authenticated / service_role（迁移里的 RLS 策略和 GRANT 引用）
 *   2. auth schema + auth.users 垫片表（外键引用、触发器挂载、测试造用户用）
 *   3. auth.uid() / auth.jwt() 垫片函数（照抄 Supabase 官方实现，读 request.jwt.claims）
 *   4. storage schema + buckets/objects 垫片表（迁移里建存储桶和策略用）
 *   5. extensions schema（pgvector 等扩展的安装位置，扩展本身由迁移文件自装）
 *
 * 注意：垫片表只保留迁移/测试实际引用的列，不等于 Supabase 真实表结构；
 *       这里只服务于"重放迁移 + 跑集成测试"，别按它理解线上结构。
 * ============================================================ */

/* ---------- 1. Supabase 预置角色（NOLOGIN，纯授权用） ---------- */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

/* ---------- 2/3. auth schema + users 垫片表 + 身份函数 ---------- */
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID,
  aud TEXT,
  role TEXT,
  email TEXT,
  encrypted_password TEXT,
  email_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

/* 与 Supabase 官方一致：优先 request.jwt.claim.sub，其次 request.jwt.claims 里的 sub */
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

/* ---------- 4. storage schema + 垫片表 ---------- */
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN DEFAULT false,
  allowed_mime_types TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT,
  owner UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

/* ---------- 5. extensions schema（pg_trgm / vector 由迁移文件自行 CREATE EXTENSION） ---------- */
CREATE SCHEMA IF NOT EXISTS extensions;
