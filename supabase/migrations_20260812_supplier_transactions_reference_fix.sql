/* 补列: supplier_transactions.reference_id / reference_type */
/* 创建日期: 2026-08-12 */
/* 背景:
     migrations_20260519_inbound_return_orders.sql 第七部分本应给 supplier_transactions
     追加 reference_id/reference_type 两列,但生产库实际没有(该段未生效)。
     后果:原客户端「确认入库」生成应付款时 INSERT 带 reference_id,整列不存在导致整句失败,
     又被 console.warn 静默吞掉——生产上采购入库的应付款记录一条都没有(已查证为 0 条)。
   本迁移:补齐两列,入库/退货事务函数的应付款记账即可正常工作。
*/

ALTER TABLE supplier_transactions
  ADD COLUMN IF NOT EXISTS reference_id UUID,
  ADD COLUMN IF NOT EXISTS reference_type TEXT;

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_reference
  ON supplier_transactions(reference_type, reference_id);
