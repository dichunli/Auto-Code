/* ============================================================
 * part_vehicle_prices 重放安全兜底建表（2026-09-19，严谨性整改阶段二 · 任务13 补）
 *
 * 背景：CI 从裸库重放全部迁移建库时，本表【从未被成功创建】——
 *   0505 建表语句里 vehicle_model_id 是 UUID 而 vehicle_models.id 是 INTEGER，
 *   FK 类型错位导致整个 CREATE TABLE 失败（该错误在白名单内被容错放过），
 *   后续 fix_vehicle_model_id_type 迁移又只 ALTER 不 CREATE。
 *   生产库此表存在（当年建成），所以问题一直没暴露；
 *   直到 save_part_form（20260919_y）在 CI 里引用此表才炸出来。
 *
 * 处理：按生产库【最终结构】IF NOT EXISTS 兜底建表（生产已存在则零操作），
 *   让裸库重放也能得到这张表。结构以 2026-09-19 生产 information_schema 实测为准。
 * 幂等：IF NOT EXISTS + DROP POLICY IF EXISTS，重跑无害。
 * ============================================================ */

CREATE TABLE IF NOT EXISTS public.part_vehicle_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  vehicle_model_id INTEGER NOT NULL REFERENCES public.vehicle_models(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  sales_price NUMERIC(10,2),
  vip_price NUMERIC(10,2),
  standard_price NUMERIC(10,2),
  UNIQUE(part_id, vehicle_model_id)
);

CREATE INDEX IF NOT EXISTS idx_part_vehicle_prices ON public.part_vehicle_prices(part_id, vehicle_model_id);

ALTER TABLE public.part_vehicle_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_part_vehicle_prices" ON public.part_vehicle_prices;
CREATE POLICY "allow_all_part_vehicle_prices" ON public.part_vehicle_prices
  FOR ALL USING (true) WITH CHECK (true);

/* 台账登记 */
INSERT INTO migration_log (file_name) VALUES ('migrations_20260919_aa_part_vehicle_prices_guard.sql') ON CONFLICT DO NOTHING;
