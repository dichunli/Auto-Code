/* 给 purchase_order_items 增加 not_arrived_reason 字段
   场景:采购管理「待收货」中按明细确认到货/未到货时记录未到货原因 */

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS not_arrived_reason TEXT;
