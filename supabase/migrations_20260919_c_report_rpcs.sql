/* ============================================================
 * 报表聚合 RPC：利润分析 + 员工业绩（2026-09-19，9-15 诊断🟠#11）
 *
 * 背景：reports/profit（5 张表全量+按工单循环）、reports/performance
 *   （4 张表全量）把整表拉进内存聚合，数据量涨后报表页必超时。
 *   收编为数据库端聚合：一次 RPC 返回汇总数字，口径逐行对齐原 JS 逻辑。
 * 口径对照（原 page.tsx 注释）：
 *   利润：营收=已结算/已交车工单总额；配件成本=选中分支 quantity×COALESCE(cost_price,unit_cost,0)；
 *         工时成本=提成合计；其它成本=work_order_other_costs；净利=毛利-提成-其它成本-运营支出+其他收入
 *   业绩：完成项目/分配业绩=work_order_item_mechanics join 项目(completed)；
 *         参与工单=多人表∪旧单人字段去重；工时=construction_logs(action=complete) 秒转小时
 * 权限：INVOKER（走调用者 RLS，与原页面直查口径一致），未登录拒绝。
 * 幂等：CREATE OR REPLACE（新函数无旧版），可重跑。
 * ============================================================ */

/* ─── 一、利润分析汇总（reports/profit/page.tsx） ─── */
CREATE OR REPLACE FUNCTION public.report_profit_summary()
RETURNS JSONB
SET search_path = public
AS $func$
DECLARE
  v_revenue NUMERIC;        /* 总营收 */
  v_parts_sales NUMERIC;    /* 配件收入 */
  v_labor_sales NUMERIC;    /* 工时收入 */
  v_other_sales NUMERIC;    /* 其他收费 */
  v_parts_real_cost NUMERIC;/* 配件真实成本 */
  v_commission NUMERIC;     /* 技师提成 */
  v_other_costs NUMERIC;    /* 工单其它成本（退货运费分摊等） */
  v_expense NUMERIC;        /* 运营支出 */
  v_income NUMERIC;         /* 其他收入 */
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 营收四项：已结算/已交车工单（SUM 忽略 NULL，与原 JS (x||0) 累加等价） */
  SELECT COALESCE(SUM(total_cost), 0), COALESCE(SUM(parts_cost), 0),
         COALESCE(SUM(labor_cost), 0), COALESCE(SUM(other_cost), 0)
  INTO v_revenue, v_parts_sales, v_labor_sales, v_other_sales
  FROM work_orders
  WHERE status IN ('settled', 'delivered');

  /* 配件真实成本：选中分支 ×（含运费成本价 优先，否则裸成本价）；
     quantity 为 NULL 的行乘积为 NULL，SUM 忽略——与原 JS 乘 0 等价 */
  SELECT COALESCE(SUM(p.quantity * COALESCE(p.cost_price, p.unit_cost, 0)), 0)
  INTO v_parts_real_cost
  FROM work_order_item_parts p
  JOIN work_order_items i ON i.id = p.work_order_item_id
  JOIN work_orders w ON w.id = i.work_order_id
  WHERE w.status IN ('settled', 'delivered')
    AND p.is_selected = true;

  /* 技师提成总额 */
  SELECT COALESCE(SUM(m.commission_amount), 0)
  INTO v_commission
  FROM work_order_item_mechanics m
  JOIN work_order_items i ON i.id = m.work_order_item_id
  JOIN work_orders w ON w.id = i.work_order_id
  WHERE w.status IN ('settled', 'delivered');

  /* 工单其它成本明细（2026-09-18 起计入） */
  SELECT COALESCE(SUM(c.amount), 0)
  INTO v_other_costs
  FROM work_order_other_costs c
  JOIN work_orders w ON w.id = c.work_order_id
  WHERE w.status IN ('settled', 'delivered');

  /* 运营支出 / 其他收入（全量财务流水，不分工单状态——与原 JS 一致） */
  SELECT COALESCE(SUM(amount), 0) INTO v_expense FROM finance_transactions WHERE type = 'expense';
  SELECT COALESCE(SUM(amount), 0) INTO v_income FROM finance_transactions WHERE type = 'income';

  RETURN jsonb_build_object(
    'total_revenue', v_revenue,
    'parts_sales', v_parts_sales,
    'labor_sales', v_labor_sales,
    'other_sales', v_other_sales,
    'parts_real_cost', v_parts_real_cost,
    'commission', v_commission,
    'other_costs', v_other_costs,
    'operating_expense', v_expense,
    'other_income', v_income
  );
END;
$func$ LANGUAGE plpgsql;

/* ─── 二、员工业绩汇总（reports/performance/page.tsx） ─── */
CREATE OR REPLACE FUNCTION public.report_performance_summary()
RETURNS JSONB
SET search_path = public
AS $func$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  RETURN (
    WITH 业绩 AS (
      /* 完成项目数/分配业绩：多人施工表 join 项目（仅 completed），按 share_pct 折算 */
      SELECT m.mechanic_id,
             COUNT(*) AS item_count,
             SUM(COALESCE(i.total_price, 0) * COALESCE(m.share_pct, 100) / 100.0) AS total_value
      FROM work_order_item_mechanics m
      JOIN work_order_items i ON i.id = m.work_order_item_id
      WHERE i.status = 'completed'
      GROUP BY m.mechanic_id
    ),
    参与 AS (
      /* 参与工单数：多人施工表 ∪ 旧单人 mechanic_id 字段，按工单去重 */
      SELECT mechanic_id, COUNT(DISTINCT wo_id) AS wo_count FROM (
        SELECT m.mechanic_id, i.work_order_id AS wo_id
        FROM work_order_item_mechanics m
        JOIN work_order_items i ON i.id = m.work_order_item_id
        UNION
        SELECT mechanic_id, work_order_id FROM work_order_items WHERE mechanic_id IS NOT NULL
      ) t GROUP BY mechanic_id
    ),
    工时 AS (
      SELECT mechanic_id, SUM(COALESCE(duration_seconds, 0)) / 3600.0 AS hours
      FROM work_order_item_construction_logs
      WHERE action = 'complete'
      GROUP BY mechanic_id
    )
    SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) FROM (
      SELECT p.id,
             p.full_name AS name,
             COALESCE(ml.name, '') AS level,
             COALESCE(ml.share_coefficient, 1) AS level_coeff,
             COALESCE(c.wo_count, 0) AS work_order_count,
             COALESCE(e.item_count, 0) AS item_count,
             COALESCE(e.total_value, 0) AS total_value,
             COALESCE(h.hours, 0) AS total_hours
      FROM profiles p
      LEFT JOIN mechanic_levels ml ON ml.id = p.mechanic_level_id
      LEFT JOIN 参与 c ON c.mechanic_id = p.id
      LEFT JOIN 业绩 e ON e.mechanic_id = p.id
      LEFT JOIN 工时 h ON h.mechanic_id = p.id
      WHERE p.is_active = true
      ORDER BY COALESCE(e.total_value, 0) DESC
    ) r
  );
END;
$func$ LANGUAGE plpgsql;

/* ─── 权限：收回匿名，放行登录用户（对齐其他只读统计函数） ─── */
REVOKE EXECUTE ON FUNCTION public.report_profit_summary() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_profit_summary() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.report_performance_summary() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_performance_summary() TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_c_report_rpcs.sql') ON CONFLICT DO NOTHING;
