-- ============================================================
-- 工单预收款（advance_payment）
-- ============================================================

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS advance_payment DECIMAL(10,2) DEFAULT 0;

COMMENT ON COLUMN work_orders.advance_payment IS '客户预交金额，结算时自动抵扣';
