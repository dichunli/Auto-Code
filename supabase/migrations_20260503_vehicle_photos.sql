-- 车辆照片表
CREATE TABLE IF NOT EXISTS vehicle_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON vehicle_photos(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_category ON vehicle_photos(vehicle_id, category);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-media', 'vehicle-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for vehicle-media bucket
CREATE POLICY "vehicle_media_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'vehicle-media');

CREATE POLICY "vehicle_media_auth_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vehicle-media');

CREATE POLICY "vehicle_media_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'vehicle-media');
