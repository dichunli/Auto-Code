-- 客户照片表
CREATE TABLE IF NOT EXISTS customer_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_photos_customer ON customer_photos(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_category ON customer_photos(customer_id, category);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-media', 'customer-media', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for customer-media bucket
CREATE POLICY "customer_media_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'customer-media');

CREATE POLICY "customer_media_auth_upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'customer-media');

CREATE POLICY "customer_media_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'customer-media');
