/* ============================================================
   三滤OE号缓存表：缓存VIN查到的OE号及关联车型数据
   ============================================================ */

CREATE TABLE IF NOT EXISTS vin_filter_cache (
  vin TEXT NOT NULL,
  filter_type TEXT NOT NULL, /* oil / air / cabin */
  oe_number TEXT NOT NULL,
  name TEXT,
  source_brand TEXT,         /* 用哪个品牌查到的，如博世 */
  vin17_group_id TEXT,       /* VIN解码获取的品牌分组ID */
  /* 17VIN返回的原始适配车型数据 */
  model_data JSONB,
  /* 匹配到本地车型库的ID列表 */
  matched_model_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (vin, filter_type)
);

CREATE INDEX IF NOT EXISTS idx_vin_filter_cache_updated ON vin_filter_cache(updated_at);

/* RLS策略：所有登录用户可读写 */
ALTER TABLE vin_filter_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON vin_filter_cache
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
