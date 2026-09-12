/* ============================================================
 * 主管授权码保密化（2026-09-12 诊断 P1）
 *
 * 背景：system_settings 的读取策略是 authenticated USING(true)——
 * 任何登录员工都能直接读出授权码明文，"重复开单需主管授权"的管控形同虚设。
 * 本迁移把读取收紧为仅管理员：
 *   - 设置页由管理员在服务端读取（是否已设置），不再把明文发到浏览器
 *   - 开单时的"验证授权码"改走 Server Action（验证主管授权码），
 *     服务端用 admin 客户端比对，只回"对不对"
 * 写策略（system_settings_admin_manage）本来就是仅管理员，不动。
 * ============================================================ */
DROP POLICY IF EXISTS system_settings_select_all ON system_settings;
CREATE POLICY system_settings_select_all ON system_settings FOR SELECT TO authenticated
USING (public.is_admin());
