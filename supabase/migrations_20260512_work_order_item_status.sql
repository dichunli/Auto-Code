-- 扩展 work_order_items 状态约束，为8阶段看板预留枚举值
-- 现有业务流程仍使用 pending/in_progress/paused/completed
-- 看板通过 work_orders.status + work_order_items 字段联合推断展示列

ALTER TABLE work_order_items
DROP CONSTRAINT IF EXISTS work_order_items_status_check;

ALTER TABLE work_order_items
ADD CONSTRAINT work_order_items_status_check
CHECK (status IN (
  'pending',             -- 等待施工（默认值，覆盖待诊断/待派工/待施工三个看板列）
  'pending_diagnosis',   -- 待诊断（预留）
  'pending_dispatch',    -- 待派工（预留）
  'pending_construction',-- 待施工（预留）
  'in_progress',         -- 施工中
  'paused',              -- 已中断
  'completed',           -- 已完工
  'pending_qc',          -- 待质检（预留）
  'settled'              -- 已结单（预留）
));
