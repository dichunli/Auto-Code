/* 系统告警表（watchdog 用）
   创建日期: 2026-09-04
   背景: PM2 崩了/磁盘满了/服务挂了，以前没人知道。watchdog 脚本每 5 分钟
         检查一次，异常写这张表，管理员在「错误日志」页能看到。
   设计: 登录即可读（告警要能被看到），写仅服务端（service key）。
*/

CREATE TABLE IF NOT EXISTS system_alerts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_created ON system_alerts(created_at DESC);

ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_alerts_select ON system_alerts
  FOR SELECT TO authenticated USING (true);

/* 登记台账（台账表还没建过则跳过，不报错） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'migration_log') THEN
    INSERT INTO migration_log (file_name, note)
    VALUES ('migrations_20260904_system_alerts.sql', '系统告警表(watchdog用)')
    ON CONFLICT (file_name) DO NOTHING;
  END IF;
END $$;
