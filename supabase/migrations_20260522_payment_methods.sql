/* 收款方式预设管理 + 预收款字段扩展 */

/* 1. 创建收款方式表 */
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_active ON payment_methods(is_active);
CREATE INDEX IF NOT EXISTS idx_payment_methods_sort ON payment_methods(sort_order);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_payment_methods" ON payment_methods;
CREATE POLICY "allow_all_payment_methods" ON payment_methods
  FOR ALL USING (true) WITH CHECK (true);

/* 2. 插入默认收款方式 */
INSERT INTO payment_methods (code, name, sort_order) VALUES
  ('cash', '现金', 1),
  ('wechat', '微信', 2),
  ('alipay', '支付宝', 3),
  ('bank_transfer', '银行转账', 4)
ON CONFLICT (code) DO NOTHING;

/* 3. 移除 advance_payment_records.method 的 CHECK 约束，使其可以存入任意收款方式 */
ALTER TABLE advance_payment_records ALTER COLUMN method TYPE TEXT;

/* 4. 预收款记录表添加收款人信息冗余字段（方便显示，实际以 profiles 表为准） */
ALTER TABLE advance_payment_records
ADD COLUMN IF NOT EXISTS collector_name TEXT;
