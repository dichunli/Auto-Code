/* 车型库搜索性能优化：添加组合搜索字段和 GIN 索引，支持9万+数据量高效模糊搜索 */

/* 确保 pg_trgm 扩展已启用（用于中文模糊匹配加速） */
CREATE EXTENSION IF NOT EXISTS pg_trgm;

/* 添加组合搜索生成列：把常用搜索字段拼在一起，方便统一搜索 */
ALTER TABLE vehicle_models
ADD COLUMN IF NOT EXISTS 搜索字段 TEXT
GENERATED ALWAYS AS (
  COALESCE(品牌, '') || ' ' ||
  COALESCE(车系, '') || ' ' ||
  COALESCE(车型, '') || ' ' ||
  COALESCE(厂商, '') || ' ' ||
  COALESCE(发动机型号, '') || ' ' ||
  COALESCE(底盘代号, '') || ' ' ||
  COALESCE(销售版本, '') || ' ' ||
  COALESCE(变速箱类型, '') || ' ' ||
  COALESCE(变速箱代号, '')
) STORED;

/* 创建 GIN 索引：加速前后模糊匹配（ilike %关键词%） */
CREATE INDEX IF NOT EXISTS idx_vehicle_models_搜索字段_gin
ON vehicle_models USING gin(搜索字段 gin_trgm_ops);
