/* ═══════════════════════════════════════════════════════════════════
 * 工单列表分页优化 — 补充索引
 *
 * 背景：工单列表页按创建时间倒序排列并分页，但 work_orders 表此前
 *       缺少 created_at 索引，数据量增大后排序/分页会变慢。
 *
 * 已有索引（无需重复）：
 *   status、vehicle_id、customer_id、order_type、
 *   (status, order_type)、(vehicle_id, order_type)
 *
 * 本次新增三个索引，配合列表页的「数据库层分页」改造，
 * 让常用的浏览场景（在修工单、历史工单、各类型工单）在
 * 数据量达到几十万条时仍能保持毫秒级响应。
 * ═══════════════════════════════════════════════════════════════════ */

/* 1) 创建时间倒序索引 —— 支撑列表整体排序与翻页 */
CREATE INDEX IF NOT EXISTS idx_work_orders_created_at
  ON work_orders (created_at DESC);

/* 2) 状态 + 创建时间组合索引 —— 支撑「历史工单」按状态筛选后再按时间翻页 */
CREATE INDEX IF NOT EXISTS idx_work_orders_status_created_at
  ON work_orders (status, created_at DESC);

/* 3) 工单类型 + 创建时间组合索引 —— 支撑「预约单/报价单/作废工单」等类型页翻页 */
CREATE INDEX IF NOT EXISTS idx_work_orders_order_type_created_at
  ON work_orders (order_type, created_at DESC);
