/* 迁移执行台账表
   创建日期: 2026-08-29
   背景: 待办清单第13项——迁移靠 Dashboard 手动粘贴，没有"哪个执行过"的记录，
         已踩过"文件写了但没执行"(0523 约束漏 3 个月)和"0820 同日顺序雷"。
   用法: 每次在 Dashboard 执行完一个迁移文件后，接着跑一行登记:
         INSERT INTO migration_log (file_name) VALUES ('migrations_20260829_xxx.sql');
   查最近执行:
         SELECT file_name, executed_at, note FROM migration_log ORDER BY executed_at DESC LIMIT 20;
   防漏自查: 把仓库 supabase/ 下的迁移文件名与台账对比即可。
*/

CREATE TABLE IF NOT EXISTS migration_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_name TEXT NOT NULL UNIQUE,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_by TEXT,
  note TEXT
);

/* 登录即可读（任何人都能查台账确认迁移状态），写仅 admin/boss */
ALTER TABLE migration_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY migration_log_select ON migration_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY migration_log_insert ON migration_log
  FOR INSERT TO authenticated WITH CHECK (public.has_role('admin','boss'));

/* 登记本表自身的建立 */
INSERT INTO migration_log (file_name, note) VALUES ('migrations_20260829_migration_log.sql', '台账表建立');
