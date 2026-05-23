/* ============================================================
   主管授权码系统 — 防止同一车牌重复开单
   ============================================================ */

/* 系统设置表 */
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

/* 默认授权码：888888（首次部署后建议在后台修改） */
INSERT INTO system_settings (key, value, description) VALUES
('supervisor_code', '888888', '主管授权码，用于同一车牌重复开单时的授权验证')
ON CONFLICT (key) DO NOTHING;

/* RLS：管理员可读写，其他用户只读 */
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_settings_select_all ON system_settings
  FOR SELECT USING (true);

CREATE POLICY system_settings_admin_manage ON system_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_active = true
    )
  );
