/*
  一次性恢复脚本 — 把因为旧 CHECK 约束卡住的订单推到正确状态
  日期: 2026-05-17

  背景:
    在 migrations_20260517_purchase_status_check_fix.sql 执行之前,
    所有走过新「收货」弹窗的订单,明细 handle_action 已写入,
    但订单状态 UPDATE 到 'pending_storage' 被旧 CHECK 拒绝,silently 失败。
    导致这些订单不在「待收货」也不在「待入库」。

  本脚本:
    找出所有「明细全部有 handle_action」且「状态仍卡在 submitted/approved/partial_received」的订单,
    一次性推到 'pending_storage'。

  注意: 必须先执行 migrations_20260517_purchase_status_check_fix.sql。
*/

UPDATE purchase_orders po
SET status = 'pending_storage'
WHERE po.status IN ('submitted', 'approved', 'partial_received')
  AND EXISTS (
    SELECT 1 FROM purchase_order_items poi
    WHERE poi.order_id = po.id
      AND poi.handle_action IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM purchase_order_items poi
    WHERE poi.order_id = po.id
      AND (poi.handle_action IS NULL OR poi.handle_action = '')
  );

/* 同时把对应运单状态推为 received */
UPDATE logistics_waybills wb
SET status = 'received', received_at = COALESCE(received_at, NOW())
WHERE wb.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM purchase_orders po
    WHERE po.waybill_id = wb.id
      AND po.status = 'pending_storage'
  );
