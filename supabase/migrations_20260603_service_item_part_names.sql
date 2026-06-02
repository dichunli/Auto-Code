/* ============================================================
   维修项目关联配件名称
   ============================================================ */

CREATE TABLE IF NOT EXISTS service_item_part_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id UUID NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
  part_name_id UUID NOT NULL REFERENCES part_names(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER,
  UNIQUE(service_item_id, part_name_id)
);

CREATE INDEX IF NOT EXISTS idx_sipn_service ON service_item_part_names(service_item_id);
CREATE INDEX IF NOT EXISTS idx_sipn_part ON service_item_part_names(part_name_id);

ALTER TABLE service_item_part_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_access" ON service_item_part_names;
CREATE POLICY "auth_full_access" ON service_item_part_names
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
