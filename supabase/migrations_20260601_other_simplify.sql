/* ============================================================
   其它收支简化：name 可选，account_id 指向 payment_methods
   ============================================================ */

/* name 改为可选 */
ALTER TABLE other_transactions ALTER COLUMN name DROP NOT NULL;

/* 删除旧的账户外键（指向 finance_accounts） */
ALTER TABLE other_transactions DROP CONSTRAINT IF EXISTS other_transactions_account_id_fkey;

/* 如果 account_id 列存在，删除重建 */
ALTER TABLE other_transactions DROP COLUMN IF EXISTS account_id;
DROP INDEX IF EXISTS idx_other_transactions_account;

/* 重新添加 account_id，指向 payment_methods */
ALTER TABLE other_transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES payment_methods(id);
CREATE INDEX IF NOT EXISTS idx_other_transactions_account ON other_transactions(account_id);

/* 增加图片字段 */
ALTER TABLE other_transactions ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
