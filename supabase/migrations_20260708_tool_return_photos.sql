/* ============================================================
 * 工具归还增强：拍照验收 + 位置扫码
 *
 * 1. tools 表加两个开关字段
 * 2. tool_return_photos 表存归还验收照片
 * ============================================================ */

/* 工具表加拍照和位置要求 */
ALTER TABLE tools ADD COLUMN IF NOT EXISTS require_return_photos BOOLEAN DEFAULT false;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS require_location_scan BOOLEAN DEFAULT false;

/* 归还照片表 */
CREATE TABLE IF NOT EXISTS tool_return_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_record_id UUID NOT NULL REFERENCES tool_borrow_records(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_photos_record ON tool_return_photos(borrow_record_id);
CREATE INDEX IF NOT EXISTS idx_return_photos_tool ON tool_return_photos(tool_id);

/* RLS */
ALTER TABLE tool_return_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "认证用户可读写归还照片" ON tool_return_photos;
CREATE POLICY "认证用户可读写归还照片" ON tool_return_photos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
