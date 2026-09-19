/* ============================================================
 * 报表统一排除作废工单（2026-09-19，严谨性整改阶段一 · 任务3）
 *
 * 问题：作废（order_type='cancelled'）只改类型字段、不动 status，
 *   而所有报表只按 status 过滤 —— 已结算再作废的工单照样计入
 *   利润、业绩、营收、工单统计，数字被污染。
 *
 * 口径定义（修复后）：order_type IS DISTINCT FROM 'cancelled' 才进报表。
 *   IS DISTINCT FROM 兼容 order_type 为 NULL 的历史数据（视为正常单）。
 *   涉及：report_profit_summary（4 处工单过滤）、report_performance_summary
 *   （业绩/参与 2 处）、report_work_order_stats、v_daily_revenue。
 *   工时（construction_logs）是真实付出的人力时间，不过滤。
 *
 * 配套：服务端 action"转换工单类型"已加门禁——已结算/已交车工单
 *   禁止直接作废（钱已收，必须走解锁/退款流程），见同提交 actions.ts。
 *
 * 幂等：全部 CREATE OR REPLACE，重跑无害。
 * ============================================================ */

/* ─── 一、利润分析汇总：4 处工单过滤补作废排除 ─── */
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
  v_expense NUMERIC;        /* 运营支出（仅经营性损益科目） */
  v_income NUMERIC;         /* 其他收入（仅经营性损益科目） */
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '未登录或登录已过期');
  END IF;

  /* 营收四项：已结算/已交车且未作废的工单 */
  SELECT COALESCE(SUM(total_cost), 0), COALESCE(SUM(parts_cost), 0),
         COALESCE(SUM(labor_cost), 0), COALESCE(SUM(other_cost), 0)
  INTO v_revenue, v_parts_sales, v_labor_sales, v_other_sales
  FROM work_orders
  WHERE status IN ('settled', 'delivered')
    AND order_type IS DISTINCT FROM 'cancelled';

  /* 配件真实成本：选中分支 ×（含运费成本价 优先，否则裸成本价） */
  SELECT COALESCE(SUM(p.quantity * COALESCE(p.cost_price, p.unit_cost, 0)), 0)
  INTO v_parts_real_cost
  FROM work_order_item_parts p
  JOIN work_order_items i ON i.id = p.work_order_item_id
  JOIN work_orders w ON w.id = i.work_order_id
  WHERE w.status IN ('settled', 'delivered')
    AND w.order_type IS DISTINCT FROM 'cancelled'
    AND p.is_selected = true;

  /* 技师提成总额 */
  SELECT COALESCE(SUM(m.commission_amount), 0)
  INTO v_commission
  FROM work_order_item_mechanics m
  JOIN work_order_items i ON i.id = m.work_order_item_id
  JOIN work_orders w ON w.id = i.work_order_id
  WHERE w.status IN ('settled', 'delivered')
    AND w.order_type IS DISTINCT FROM 'cancelled';

  /* 工单其它成本明细 */
  SELECT COALESCE(SUM(c.amount), 0)
  INTO v_other_costs
  FROM work_order_other_costs c
  JOIN work_orders w ON w.id = c.work_order_id
  WHERE w.status IN ('settled', 'delivered')
    AND w.order_type IS DISTINCT FROM 'cancelled';

  /* 运营支出 / 其他收入：仅经营性损益科目（counts_in_profit=TRUE，见 _n 迁移） */
  SELECT COALESCE(SUM(t.amount), 0) INTO v_expense
  FROM finance_transactions t
  LEFT JOIN finance_categories fc ON fc.id = t.category_id
  WHERE t.type = 'expense' AND COALESCE(fc.counts_in_profit, TRUE);

  SELECT COALESCE(SUM(t.amount), 0) INTO v_income
  FROM finance_transactions t
  LEFT JOIN finance_categories fc ON fc.id = t.category_id
  WHERE t.type = 'income' AND COALESCE(fc.counts_in_profit, TRUE);

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

/* ─── 二、员工业绩汇总：业绩/参与排除作废单（工时保留） ─── */
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
      /* 完成项目数/分配业绩：多人施工表 join 项目（仅 completed 且工单未作废），按 share_pct 折算 */
      SELECT m.mechanic_id,
             COUNT(*) AS item_count,
             SUM(COALESCE(i.total_price, 0) * COALESCE(m.share_pct, 100) / 100.0) AS total_value
      FROM work_order_item_mechanics m
      JOIN work_order_items i ON i.id = m.work_order_item_id
      JOIN work_orders w ON w.id = i.work_order_id
      WHERE i.status = 'completed'
        AND w.order_type IS DISTINCT FROM 'cancelled'
      GROUP BY m.mechanic_id
    ),
    参与 AS (
      /* 参与工单数：多人施工表 ∪ 旧单人 mechanic_id 字段，按工单去重（排除作废单） */
      SELECT mechanic_id, COUNT(DISTINCT wo_id) AS wo_count FROM (
        SELECT m.mechanic_id, i.work_order_id AS wo_id
        FROM work_order_item_mechanics m
        JOIN work_order_items i ON i.id = m.work_order_item_id
        JOIN work_orders w ON w.id = i.work_order_id
        WHERE w.order_type IS DISTINCT FROM 'cancelled'
        UNION
        SELECT i2.mechanic_id, i2.work_order_id
        FROM work_order_items i2
        JOIN work_orders w2 ON w2.id = i2.work_order_id
        WHERE i2.mechanic_id IS NOT NULL
          AND w2.order_type IS DISTINCT FROM 'cancelled'
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

/* ─── 三、工单统计：排除作废单 ─── */
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
      WHERE order_type IS DISTINCT FROM 'cancelled'
      GROUP BY status
    ) r
  );
END;
$func$ LANGUAGE plpgsql;

/* ─── 四、营收日报视图：排除作废单（保留 _o 的挂账排除口径） ─── */
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
  DATE(wo.settled_at) AS date,
  COUNT(*) AS order_count,
  SUM(wo.parts_cost) AS total_parts_cost,
  SUM(wo.labor_cost) AS total_labor_cost,
  SUM(wo.other_cost) AS total_other_cost,
  SUM(wo.total_cost) AS total_revenue,
  SUM(COALESCE(p.amount, 0)) AS total_paid
FROM work_orders wo
LEFT JOIN (
  /* 实收口径：排除挂账行；IS DISTINCT FROM 兼容 method 为 NULL 的历史数据 */
  SELECT work_order_id, SUM(amount) AS amount
  FROM payments
  WHERE method IS DISTINCT FROM 'credit'
  GROUP BY work_order_id
) p ON p.work_order_id = wo.id
WHERE wo.status IN ('settled', 'delivered')
  AND wo.settled_at IS NOT NULL
  AND wo.order_type IS DISTINCT FROM 'cancelled'
GROUP BY DATE(wo.settled_at)
ORDER BY date DESC;

/* 权限兜底重申（CREATE OR REPLACE 保留旧授权） */
REVOKE EXECUTE ON FUNCTION public.report_profit_summary() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_profit_summary() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.report_performance_summary() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_performance_summary() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.report_work_order_stats() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_work_order_stats() TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_p_reports_exclude_cancelled.sql') ON CONFLICT DO NOTHING;
