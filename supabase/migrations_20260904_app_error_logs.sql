/* 前端错误日志表
   创建日期: 2026-09-04
   背景: 页面 JS 报错以前只能靠用户口头描述。建表收集全局错误
         （window.onerror / unhandledrejection），管理页可查。
   设计: 登录即可写（报错不该被权限拦住，写不进去的错误等于没报），
         仅 admin/boss 可读。
*/

CREATE TABLE IF NOT EXISTS app_error_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES profiles(id),
  message TEXT NOT NULL,
  stack TEXT,
  url TEXT,
  user_agent TEXT,
  env TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_error_logs_created ON app_error_logs(created_at DESC);

ALTER TABLE app_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_error_logs_insert ON app_error_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY app_error_logs_select ON app_error_logs
  FOR SELECT TO authenticated USING (public.has_role('admin','boss'));

/* 登记台账（台账表还没建过则跳过，不报错） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'migration_log') THEN
    INSERT INTO migration_log (file_name, note)
    VALUES ('migrations_20260904_app_error_logs.sql', '前端错误日志表')
    ON CONFLICT (file_name) DO NOTHING;
  END IF;
END $$;
