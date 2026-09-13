/* ============================================================
 * employee_groups 开启 RLS + 通用 RLS 巡检函数
 *
 * 2026-09-12 诊断发现：employee_groups 表 2026-08-02 建了 4 条权限策略，
 * 但 RLS 开关从来没打开——PostgreSQL 里不开开关策略等于废纸，
 * 该表一直处于"谁都能读写"状态。8-06 补漏 12 张表的迁移也漏了它。
 *
 * 附带 list_tables_without_rls()：列出 public 下所有没开 RLS 的表，
 * 给 scripts/check-rls-status.js 巡检用，防同类漏开再发生。
 * ============================================================ */
ALTER TABLE public.employee_groups ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION list_tables_without_rls()
RETURNS TABLE(table_name TEXT)
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  /* 必须已登录（SECURITY DEFINER 绕过 RLS，身份在此兜底） */
  IF auth.uid() IS NULL THEN
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
