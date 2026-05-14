/* 物流运单扩展字段
   场景:运单需要记录更多信息（电话、件数、照片） */

ALTER TABLE logistics_waybills
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS package_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb;
