/* 物流运单增加供货商名称字段
   场景:创建运单时通过运单电话自动检索供应商，记录到运单中方便后续查看 */

ALTER TABLE logistics_waybills
  ADD COLUMN IF NOT EXISTS supplier_name TEXT;
