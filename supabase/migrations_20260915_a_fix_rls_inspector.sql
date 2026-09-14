/* 修复 RLS 巡检函数：放行 service_role 调用（2026-09-15）
   背景：migrations_20260913_a 建的 list_tables_without_rls() 里写死
        "auth.uid() 为空即拒绝"，而巡检脚本 scripts/check-rls-status.js
        用 service_role 密钥调用——service_role JWT 没有用户 uid，
        导致巡检工具建成后一次都没跑成功。
   修复：uid 为空但 role 是 service_role 时放行（service key 本来只躺在
        服务器 .env.local，风险与原先"登录即可"等价）。
   说明：函数参数列表未变，CREATE OR REPLACE 即可，无需先 DROP。
*/

CREATE OR REPLACE FUNCTION list_tables_without_rls()
RETURNS TABLE(table_name TEXT)
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  /* 必须已登录，或是 service_role 服务端调用（SECURITY DEFINER 绕过 RLS，身份在此兜底） */
  IF auth.uid() IS NULL AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION '未登录或登录已过期';
  END IF;
  RETURN QUERY
  SELECT c.relname::TEXT
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false
  ORDER BY c.relname;
END;
$$ LANGUAGE plpgsql;

/* 登记台账 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_a_fix_rls_inspector.sql')
ON CONFLICT DO NOTHING;
