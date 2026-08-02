/*
 * 收尾加固（2026-08-02 官方顾问 + 自查遗留）
 * 1. 4 个库存触发函数禁止直接调用（只许由触发器触发，堵 anon/authenticated 直调告警）
 * 2. is_admin/has_role 禁止匿名调用（authenticated 必须保留，RLS 策略求值要用）
 * 3. vin17_api_logs 查看权限收紧为 admin/boss（含 17VIN 请求参数）
 */

/* 1. 触发函数只通过触发器执行，禁止任何角色直接调用 */
REVOKE EXECUTE ON FUNCTION public.deduct_part_batch_fifo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_deduct_batch_on_picking() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_restore_batch_on_return() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.return_part_to_batch() FROM PUBLIC, anon, authenticated;

/* 2. 权限判断函数禁止匿名调用（登录用户必须保留，否则 RLS 失效） */
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(text[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO authenticated;

/* 3. 17VIN 调用日志仅管理员/老板可看 */
DROP POLICY IF EXISTS "所有用户可查看17VIN调用日志" ON vin17_api_logs;
CREATE POLICY "管理员可查看17VIN调用日志" ON vin17_api_logs FOR SELECT TO authenticated
USING (public.has_role('admin','boss'));
