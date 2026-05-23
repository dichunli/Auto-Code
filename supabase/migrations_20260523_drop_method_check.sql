/* 移除预收款记录的收款方式 CHECK 约束，允许存入任意收款方式编码 */

ALTER TABLE advance_payment_records
DROP CONSTRAINT IF EXISTS advance_payment_records_method_check;
