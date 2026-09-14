/* 非空约束 + 外键索引补齐 + 通用缺索引巡检（2026-09-15，DeepSeek 诊断第 5 批）
   一、SET NOT NULL：vehicles.plate_number / parts.part_number
      （规范要求不可为空，约束一直没落到库层；已核实全库 0 空值，安全）
   二、补建 notifications 表：20260501 迁移漏执行的旧账，通知页和保养
      提醒写通知的代码一直在用它（表不存在，功能静默坏着）；定义照
      migrations_20260501_reminders.sql 原样补建
   三、补缺失的外键索引：外键列无索引会让"按外键查明细/级联删除"全表扫描
   四、list_unindexed_foreign_keys()：通用巡检函数，随时列出全库
      "有外键约束但没配索引"的列，防同类缺口靠人记
*/

/* ========== 一、非空约束 ========== */
ALTER TABLE vehicles ALTER COLUMN plate_number SET NOT NULL;
ALTER TABLE parts ALTER COLUMN part_number SET NOT NULL;

/* ========== 二、补建 notifications 表（含索引 + RLS） ========== */
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('work_order_status','maintenance_due','birthday','marketing','appointment')),
  title TEXT NOT NULL,
  content TEXT,
  channel TEXT CHECK (channel IN ('sms','wechat','app','phone')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','read')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  related_type TEXT,
  related_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_at);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'auth_full_access') THEN
    CREATE POLICY "auth_full_access" ON notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

/* ========== 三、外键索引（IF NOT EXISTS，重复执行无害） ========== */
CREATE INDEX IF NOT EXISTS idx_notifications_customer_id ON notifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_arrival_receipt_items_arrival_id ON arrival_receipt_items(arrival_id);
CREATE INDEX IF NOT EXISTS idx_arrival_receipt_items_part_id ON arrival_receipt_items(part_id);
CREATE INDEX IF NOT EXISTS idx_arrival_receipt_items_po_item_id ON arrival_receipt_items(purchase_order_item_id);
CREATE INDEX IF NOT EXISTS idx_app_error_logs_user_id ON app_error_logs(user_id);

/* ========== 三、通用缺索引巡检函数 ========== */
CREATE OR REPLACE FUNCTION list_unindexed_foreign_keys()
RETURNS TABLE(table_name TEXT, column_name TEXT)
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  /* 登录用户或 service_role 可调（与 list_tables_without_rls 同一口径） */
  IF auth.uid() IS NULL AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION '未登录或登录已过期';
  END IF;
  RETURN QUERY
  SELECT c.relname::TEXT, a.attname::TEXT
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
    AND array_length(con.conkey, 1) = 1   /* 只查单列外键 */
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = con.conrelid
        AND (i.indkey::int2[])[0] = con.conkey[1]   /* 已有索引且首列就是外键列 */
    )
  ORDER BY c.relname;
END;
$$ LANGUAGE plpgsql;

/* ========== 四、登记台账 ========== */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260915_c_notnull_fk_indexes.sql')
ON CONFLICT DO NOTHING;
