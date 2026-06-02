/* ============================================================
   其它收支表升级 — 添加账户和分类关联
   ============================================================ */

/* 添加资金账户关联 */
ALTER TABLE other_transactions
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES finance_accounts(id);

/* 添加分类关联 */
ALTER TABLE other_transactions
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES finance_categories(id);

/* 账户查询索引 */
CREATE INDEX IF NOT EXISTS idx_other_transactions_account ON other_transactions(account_id);

/* 分类查询索引 */
CREATE INDEX IF NOT EXISTS idx_other_transactions_category ON other_transactions(category_id);
