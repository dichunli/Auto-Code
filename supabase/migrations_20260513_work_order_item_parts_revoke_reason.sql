/* 给 work_order_item_parts 添加 revoke_reason 字段
   场景:采购管理「待采购」Tab 中撤销配件时记录撤销原因 */

ALTER TABLE work_order_item_parts ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
