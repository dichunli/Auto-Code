/*
 * 2026-08-02 车型库搜索字段补充 trgm 模糊搜索索引
 * 背景：性能诊断发现 发动机型号/车系/排量/轮胎规格 等字段 ILIKE '%xx%' 走全表扫描（9.6万行，单次 800ms+）
 * 上次（2026-05）只加了 品牌/年款/搜索字段 的索引，本次补齐其余常用搜索字段
 * pg_trgm 扩展已启用（搜索字段 索引在用），无需重复创建
 */

CREATE INDEX IF NOT EXISTS "idx_vehicle_models_发动机型号_trgm"
  ON public.vehicle_models USING gin ("发动机型号" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_vehicle_models_车系_trgm"
  ON public.vehicle_models USING gin ("车系" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_vehicle_models_车型_trgm"
  ON public.vehicle_models USING gin ("车型" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_vehicle_models_排量_trgm"
  ON public.vehicle_models USING gin ("排量" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_vehicle_models_前轮胎规格_trgm"
  ON public.vehicle_models USING gin ("前轮胎规格" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_vehicle_models_后轮胎规格_trgm"
  ON public.vehicle_models USING gin ("后轮胎规格" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_vehicle_models_销售名称_trgm"
  ON public.vehicle_models USING gin ("销售名称" gin_trgm_ops);
