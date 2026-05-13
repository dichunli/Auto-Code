/* 修复工单图片上传 RLS 策略问题 */

/* 1. 修复 storage bucket 上传权限 */
DROP POLICY IF EXISTS "auth_full_access_work_order_media" ON storage.objects;

CREATE POLICY "auth_full_access_work_order_media"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'work-order-media')
  WITH CHECK (bucket_id = 'work-order-media');

/* 2. 修复 work_order_item_media 表权限 */
ALTER TABLE work_order_item_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON work_order_item_media;

CREATE POLICY "auth_full_access"
  ON work_order_item_media
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

/* 3. 修复 work_order_item_part_media 表权限 */
ALTER TABLE work_order_item_part_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON work_order_item_part_media;

CREATE POLICY "auth_full_access"
  ON work_order_item_part_media
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

/* 4. 修复 work_order_item_parts 表权限（确保外键检查能通过） */
ALTER TABLE work_order_item_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON work_order_item_parts;

CREATE POLICY "auth_full_access"
  ON work_order_item_parts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
