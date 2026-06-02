/* ============================================================
   其它收支表 — 随手记录日常费用和收入
   ============================================================ */

CREATE TABLE IF NOT EXISTS other_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  name TEXT NOT NULL,
  counterparty TEXT,
  operator_id UUID REFERENCES profiles(id),
  transaction_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

/* 按月查询索引 */
CREATE INDEX IF NOT EXISTS idx_other_transactions_date ON other_transactions(transaction_date DESC);

/* 按类型查询索引 */
CREATE INDEX IF NOT EXISTS idx_other_transactions_type ON other_transactions(type);

/* RLS 策略 */
ALTER TABLE other_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "允许所有用户查看" ON other_transactions FOR SELECT USING (true);

CREATE POLICY "允许所有用户插入" ON other_transactions FOR INSERT WITH CHECK (true);

CREATE POLICY "允许所有用户更新" ON other_transactions FOR UPDATE USING (true);

CREATE POLICY "允许所有用户删除" ON other_transactions FOR DELETE USING (true);
