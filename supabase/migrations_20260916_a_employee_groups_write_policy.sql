/*
 * 紧急修复：employee_groups 写权限收紧（2026-09-15 全面诊断发现）
 * 背景：2026-08-02 安全加固时该表策略写成 WITH CHECK (true)（登录即可写），
 *       2026-09-13 打开 RLS 开关后等于"开了锁但锁是坏的"——普通员工可直接
 *       增删改员工分组，是全站唯一一个 RLS 层也不兜底的管理员功能。
 * 口径：读不动（登录即可读，避免页面报错），写收紧为 admin / boss（组织架构管理），
 *       与 src/app/employee-groups/actions.ts 的服务端校验保持一致。
 */

DROP POLICY IF EXISTS employee_groups_insert ON employee_groups;
DROP POLICY IF EXISTS employee_groups_update ON employee_groups;
DROP POLICY IF EXISTS employee_groups_delete ON employee_groups;

CREATE POLICY employee_groups_insert ON employee_groups FOR INSERT TO authenticated
  WITH CHECK (public.has_role('admin','boss'));
CREATE POLICY employee_groups_update ON employee_groups FOR UPDATE TO authenticated
  USING (public.has_role('admin','boss'));
CREATE POLICY employee_groups_delete ON employee_groups FOR DELETE TO authenticated
  USING (public.has_role('admin','boss'));

INSERT INTO migration_log (file_name) VALUES ('migrations_20260916_a_employee_groups_write_policy.sql') ON CONFLICT DO NOTHING;
