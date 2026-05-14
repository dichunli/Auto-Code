/*
  新增采购单状态: pending_storage (待入库)
  用于已确认全部到货、等待入库登记的采购单。
  purchase_orders.status 为 TEXT 类型，无 CHECK 约束，无需 ALTER TABLE。
*/

/*
  待收货页面 (PendingReceiptList) 查询范围已扩展为：
  submitted, approved, partial_received, fully_received
  其中 fully_received 的订单可点击"提交入库"，状态变为 pending_storage。

  待入库页面 (PendingStorageList) 查询：
  status = 'pending_storage'

  确认入库完成后，状态变为 completed。
*/
