/* ============================================================
   操作员收款方式绑定表
   ============================================================ */

CREATE TABLE IF NOT EXISTS operator_payment_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES profiles(id),
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(operator_id, payment_method_id)
);

CREATE INDEX IF NOT EXISTS idx_opb_operator ON operator_payment_bindings(operator_id);
CREATE INDEX IF NOT EXISTS idx_opb_payment ON operator_payment_bindings(payment_method_id);

ALTER TABLE operator_payment_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "允许所有用户查看" ON operator_payment_bindings FOR SELECT USING (true);
CREATE POLICY "允许所有用户插入" ON operator_payment_bindings FOR INSERT WITH CHECK (true);
CREATE POLICY "允许所有用户更新" ON operator_payment_bindings FOR UPDATE USING (true);
CREATE POLICY "允许所有用户删除" ON operator_payment_bindings FOR DELETE USING (true);
