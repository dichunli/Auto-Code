/* ============================================================
   车辆表唯一锁（2026-08-27 执行）
   ------------------------------------------------------------
   前置条件已满足：重复 VIN 0 组、重复车牌 0 组
   （2026-08-27 全量扫描 16041 辆车确认；8-13 明细的 44+2 组重复已被清理）

   本文件内容 = supabase/migrations_20260813_vehicles_unique_待清理后执行.sql
   两个唯一索引：
     1. VIN：非空时全局唯一（空 VIN 不限制，可以多条）
     2. 车牌号：全局唯一（车牌本来就必填）

   用法：Supabase 后台 → SQL Editor → 粘贴全部 → Run
   跑完把最下面【验证】的结果发我（期望返回 2 行）。

   万一出问题要撤销（正常不会用到）：
     DROP INDEX IF EXISTS vehicles_vin_unique;
     DROP INDEX IF EXISTS vehicles_plate_number_unique;
   ============================================================ */

/* VIN：非空时全局唯一 */
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_vin_unique
  ON public.vehicles (vin)
  WHERE vin IS NOT NULL AND vin <> '';

/* 车牌号：全局唯一且不可为空 */
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_number_unique
  ON public.vehicles (plate_number);

/* 【验证】期望返回 2 行（两个索引都在） */
SELECT indexname FROM pg_indexes
WHERE tablename = 'vehicles'
  AND indexname IN ('vehicles_vin_unique', 'vehicles_plate_number_unique');
