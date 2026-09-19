/* ============================================================
 * 利润报表双计收入修复（2026-09-19，严谨性整改阶段一 · 任务1）
 *
 * 问题（诊断实锤）：
 *   report_profit_summary 把 finance_transactions 里【全部 income】当作
 *   "其他收入"加进净利润，但结算收入、客户欠款收回本就记在这张表，
 *   而工单 total_cost 已计入 total_revenue —— 同一笔钱算两遍。
 *   同理，手工记一笔"配件采购"既算运营支出、配件领用时又进配件成本，
 *   采购入库是资产不是费用，也算两遍。
 *
 * 方案：
 *   1. finance_categories 增加 counts_in_profit 标记：
 *      TRUE  = 经营性损益科目（计入利润表的其他收入/运营支出）
 *      FALSE = 资金往来科目（维修收入、配件采购等，已在别处计入利润，禁止重复）
 *      默认 TRUE 保持手工记一笔的旧行为；NULL 分类的流水按 TRUE 处理。
 *   2. 回填：维修收入、配件采购 → FALSE。
 *   3. report_profit_summary 的其他收入/运营支出按标记过滤。
 *
 * 幂等：ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE，重跑无害。
 * ============================================================ */

/* ─── 一、收支分类加"是否计入利润"标记 ─── */
ALTER TABLE finance_categories
  ADD COLUMN IF NOT EXISTS counts_in_profit BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN finance_categories.counts_in_profit IS
  'TRUE=经营性损益科目（计入利润表）；FALSE=资金往来科目（维修收入/配件采购等已在工单营收或配件成本中体现，禁止重复计入）';

/* 回填：维修收入（结算+欠款收回写入）与配件采购（资产化，领用时才转成本）不计入利润 */
UPDATE finance_categories SET counts_in_profit = FALSE
WHERE (type = 'income' AND name = '维修收入')
   OR (type = 'expense' AND name = '配件采购');

/* ─── 二、利润分析汇总：其他收入/运营支出按标记过滤 ─── */
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

  /* 营收四项：已结算/已交车工单 */
  SELECT COALESCE(SUM(total_cost), 0), COALESCE(SUM(parts_cost), 0),
         COALESCE(SUM(labor_cost), 0), COALESCE(SUM(other_cost), 0)
  INTO v_revenue, v_parts_sales, v_labor_sales, v_other_sales
  FROM work_orders
  WHERE status IN ('settled', 'delivered');

  /* 配件真实成本：选中分支 ×（含运费成本价 优先，否则裸成本价） */
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

  /* 工单其它成本明细 */
  SELECT COALESCE(SUM(c.amount), 0)
  INTO v_other_costs
  FROM work_order_other_costs c
  JOIN work_orders w ON w.id = c.work_order_id
  WHERE w.status IN ('settled', 'delivered');

  /* 运营支出 / 其他收入：仅经营性损益科目（counts_in_profit=TRUE）。
     维修收入（结算/欠款收回）与配件采购等资金往来科目已在营收和配件成本中体现，排除防双计；
     分类为 NULL 的流水按 TRUE 处理，保持手工记一笔的旧行为 */
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

/* 权限保持：收回匿名/PUBLIC，放行登录用户（CREATE OR REPLACE 保留旧授权，此处兜底重申） */
REVOKE EXECUTE ON FUNCTION public.report_profit_summary() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_profit_summary() TO authenticated;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_n_profit_category_flag.sql') ON CONFLICT DO NOTHING;
