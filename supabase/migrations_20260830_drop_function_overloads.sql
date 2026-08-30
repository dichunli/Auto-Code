/* 修复入库/建单函数重载歧义（2026-08-30）
 *
 * 背景：0821 两个迁移给函数加参数时用了 CREATE OR REPLACE，
 * 参数列表不同 = PostgreSQL 新建重载而非替换，老签名版本残留，
 * 导致 PostgREST 调用时报 "Could not choose the best candidate function"
 * （台账自查脚本 8-30 踩到：建到货单/到货入库接口实际上处于报错状态）。
 *
 * 处理：DROP 老签名版本，只保留带新参数（含默认值）的版本。
 * DROP IF EXISTS 幂等安全，重复执行无害。
 *
 * 执行后验证（紧跟跑）：
 *   SELECT proname, pg_get_function_arguments(oid) AS args
 *   FROM pg_proc
 *   WHERE pronamespace='public'::regnamespace
 *     AND proname IN ('create_arrival_receipt','complete_arrival_inbound','complete_purchase_inbound');
 *   期望每个函数只剩 1 行，且参数末尾带新参数（DEFAULT 可空）。
*/

DROP FUNCTION IF EXISTS public.create_arrival_receipt(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.complete_arrival_inbound(uuid, numeric, uuid);
DROP FUNCTION IF EXISTS public.complete_purchase_inbound(uuid, jsonb, numeric, uuid);

/* 台账登记（台账表不存在时跳过，不影响主修复） */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log') THEN
    INSERT INTO migration_log (file_name) VALUES ('migrations_20260830_drop_function_overloads.sql') ON CONFLICT DO NOTHING;
  END IF;
END $$;
