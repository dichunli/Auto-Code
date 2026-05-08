-- 为 service_name_part_names 表补充 RLS 策略
-- 该表用于关联维修项目名称和配件名称，系统预置数据

ALTER TABLE service_name_part_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full_access" ON service_name_part_names
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
