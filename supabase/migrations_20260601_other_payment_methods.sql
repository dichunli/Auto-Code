/* ============================================================
   其它收支专用收款方式表
   ============================================================ */

/* 删除旧的 account_id 列（可能指向 finance_accounts 或 payment_methods） */
ALTER TABLE other_transactions DROP CONSTRAINT IF EXISTS other_transactions_account_id_fkey;
ALTER TABLE other_transactions DROP COLUMN IF EXISTS account_id;
DROP INDEX IF EXISTS idx_other_transactions_account;

/* 删除旧的绑定表（如果存在） */
DROP TABLE IF EXISTS operator_payment_bindings;

/* 创建其它收支专用收款方式表 */
CREATE TABLE IF NOT EXISTS other_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  operator_id UUID REFERENCES profiles(id),
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_other_payment_methods_operator ON other_payment_methods(operator_id);
CREATE INDEX IF NOT EXISTS idx_other_payment_methods_sort ON other_payment_methods(sort_order);

ALTER TABLE other_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "允许所有用户查看" ON other_payment_methods FOR SELECT USING (true);
CREATE POLICY "允许所有用户插入" ON other_payment_methods FOR INSERT WITH CHECK (true);
CREATE POLICY "允许所有用户更新" ON other_payment_methods FOR UPDATE USING (true);
CREATE POLICY "允许所有用户删除" ON other_payment_methods FOR DELETE USING (true);

/* 重新添加 account_id 指向新表 */
ALTER TABLE other_transactions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES other_payment_methods(id);
CREATE INDEX IF NOT EXISTS idx_other_transactions_account ON other_transactions(account_id);
