/* ============================================================
 * 工单统计报表聚合 RPC（2026-09-19，9-15 诊断🟠#11 补）
 *
 * 背景：reports/work-orders 拉全表工单（status, total_cost）到内存按状态分组，
 *   工单量涨后首屏必慢。改数据库端 GROUP BY 一次返回。
 * 口径：与 page.tsx 原 forEach 分组完全一致（按 status 计数+金额合计，
 *   total_cost 为 NULL 的行金额按 0 计、仍计入单数）。
 * 权限：INVOKER（走调用者 RLS，与原页面直查口径一致），未登录拒绝。
 * 幂等：CREATE OR REPLACE（新函数无旧版），可重跑。
 * ============================================================ */

CREATE OR REPLACE FUNCTION public.report_work_order_stats()
RETURNS JSONB
SET search_path = public
AS $func$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) FROM (
      SELECT status, COUNT(*) AS cnt, COALESCE(SUM(COALESCE(total_cost, 0)), 0) AS amount
      FROM work_orders
      GROUP BY status
    ) r
  );
END;
$func$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.report_work_order_stats() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_work_order_stats() TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_d_work_order_report.sql') ON CONFLICT DO NOTHING;
