/* ============================================================
 * 营收报表"实收"排除挂账（2026-09-19，严谨性整改阶段一 · 任务2）
 *
 * 问题：v_daily_revenue 的 total_paid 直接 SUM(payments.amount)，
 *   而结算 RPC 会把 method='credit'（挂账）也插进 payments 表 ——
 *   挂账是没收到的钱，导致"实收金额"虚高、"差额"（未收）被低估。
 *
 * 口径定义（修复后）：
 *   total_paid = 实收 = payments 中排除 method='credit' 的合计。
 *   member（储值卡）支付保留计入：充值时钱已到账，结算扣卡等同已收。
 *   credit（挂账）不计入：钱未收，体现在"差额"列并跟踪到应收账款。
 *
 * 幂等：CREATE OR REPLACE VIEW，重跑无害。
 * ============================================================ */

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
GROUP BY DATE(wo.settled_at)
ORDER BY date DESC;

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_o_daily_revenue_exclude_credit.sql') ON CONFLICT DO NOTHING;
