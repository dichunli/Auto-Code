-- 补全 vehicles 表缺失列
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS chassis_code TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission_type TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission_code TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- 补全 customers 表缺失列
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender TEXT;

-- 补全 vehicle_photos 表缺失列（如果表已存在但结构不完整）
ALTER TABLE vehicle_photos ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE vehicle_photos ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE vehicle_photos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 补全 customer_photos 表缺失列
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE customer_photos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 索引（安全创建）
CREATE INDEX IF NOT EXISTS idx_vehicles_company ON vehicles(company_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON vehicle_photos(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_category ON vehicle_photos(vehicle_id, category);
CREATE INDEX IF NOT EXISTS idx_customer_photos_customer ON customer_photos(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_category ON customer_photos(customer_id, category);

-- Storage buckets（安全插入）
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-media', 'vehicle-media', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-media', 'customer-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for vehicle-media（使用 DO 块避免重复创建报错）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'vehicle_media_public_read'
  ) THEN
    CREATE POLICY "vehicle_media_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'vehicle-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'vehicle_media_auth_upload'
  ) THEN
    CREATE POLICY "vehicle_media_auth_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vehicle-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'vehicle_media_auth_delete'
  ) THEN
    CREATE POLICY "vehicle_media_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'vehicle-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'customer_media_public_read'
  ) THEN
    CREATE POLICY "customer_media_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'customer-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'customer_media_auth_upload'
  ) THEN
    CREATE POLICY "customer_media_auth_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'customer-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'customer_media_auth_delete'
  ) THEN
    CREATE POLICY "customer_media_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'customer-media');
  END IF;
END
$$;
