/* 给 purchase_orders 增加 waybill_id 字段 + 索引
   场景:采购管理「待收货」Tab 中点击确认到货前,
         必须先关联一张物流运单(logistics_waybills)。 */

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS waybill_id UUID REFERENCES logistics_waybills(id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_waybill ON purchase_orders(waybill_id);
