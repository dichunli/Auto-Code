/*
  为 purchase_order_items 增加 return_reason 字段
  用于标记已到货但需要退货的配件，在入库完成后自动创建 supplier_return_records
*/

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS return_reason TEXT;

/* return_reason 取值与 supplier_return_records.return_reason 保持一致：
   wrong_ship (错发), excess (多发), damaged (破损), cancel (客户悔单)
*/
