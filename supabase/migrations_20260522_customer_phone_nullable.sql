/* ============================================================
   客户手机号改为可为空
   ============================================================ */

/* 1. 去掉 NOT NULL 约束 */
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;

/* 2. 空字符串改为 NULL，避免和唯一约束冲突 */
UPDATE customers SET phone = NULL WHERE phone = '';

/* 注意：customers_phone_unique 唯一约束保持不变。
   PostgreSQL 中 NULL 不触发唯一约束，所以多个客户可以都没有手机号。
*/
