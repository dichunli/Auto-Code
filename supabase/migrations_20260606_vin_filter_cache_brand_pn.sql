/* 为vin_filter_cache表增加品牌编码字段 */
ALTER TABLE vin_filter_cache ADD COLUMN IF NOT EXISTS brand_part_number TEXT;
