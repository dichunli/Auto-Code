/* ============================================================
   其它收支独立分类表
   ============================================================ */

/* 删除旧的分类关联（指向 finance_categories） */
ALTER TABLE other_transactions DROP CONSTRAINT IF EXISTS other_transactions_category_id_fkey;
ALTER TABLE other_transactions DROP COLUMN IF EXISTS category_id;
DROP INDEX IF EXISTS idx_other_transactions_category;

/* 创建其它收支专用分类表 */
CREATE TABLE IF NOT EXISTS other_transaction_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

/* 分类名在同一类型下唯一 */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uk_other_categories_name_type'
    AND conrelid = 'other_transaction_categories'::regclass
  ) THEN
    ALTER TABLE other_transaction_categories
      ADD CONSTRAINT uk_other_categories_name_type UNIQUE (name, type);
  END IF;
END $$;

/* 索引 */
CREATE INDEX IF NOT EXISTS idx_other_categories_type ON other_transaction_categories(type);
CREATE INDEX IF NOT EXISTS idx_other_categories_sort ON other_transaction_categories(sort_order);

/* RLS */
ALTER TABLE other_transaction_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "允许所有用户查看" ON other_transaction_categories FOR SELECT USING (true);
CREATE POLICY "允许所有用户插入" ON other_transaction_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "允许所有用户更新" ON other_transaction_categories FOR UPDATE USING (true);
CREATE POLICY "允许所有用户删除" ON other_transaction_categories FOR DELETE USING (true);

/* 重新添加 category_id，指向新表 */
ALTER TABLE other_transactions ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES other_transaction_categories(id);
CREATE INDEX IF NOT EXISTS idx_other_transactions_category ON other_transactions(category_id);
