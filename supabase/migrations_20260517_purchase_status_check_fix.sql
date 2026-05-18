/*
  修复 purchase_orders.status 的 CHECK 约束
  日期: 2026-05-17

  问题:
    原约束(migrations_20260501_purchase_orders.sql)只允许:
      'draft', 'submitted', 'approved', 'partial_received', 'fully_received', 'cancelled'
    导致代码尝试把状态更新为 'pending_storage' 或 'completed' 时
    被数据库 silently 拒绝,采购单无法流转到「待入库」。

    migrations_20260514_pending_storage_status.sql 错误地声称"无 CHECK 约束"。

  本迁移:
    删除旧 CHECK,加上覆盖全流程的新约束。
*/

ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN (
    'draft',
    'submitted',
    'approved',
    'partial_received',
    'fully_received',
    'pending_storage',
    'completed',
    'cancelled'
  ));
