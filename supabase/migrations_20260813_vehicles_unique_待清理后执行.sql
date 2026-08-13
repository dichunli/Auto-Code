/*
 * 数据库层唯一性约束（第二批：车辆表 —— 必须先清理完重复数据才能执行！！）
 *
 * 执行前提（缺一不可）：
 *   1. 44 组重复 VIN 已逐组人工确认处理（明细见 docs/重复车辆明细-20260813.csv）
 *   2. 2 组重复车牌已处理（含黑AV8B90 空记录删除）
 *
 * 验证 SQL（两个都返回 0 才能执行本文件）：
 *   SELECT COUNT(*) FROM (SELECT vin FROM vehicles WHERE vin IS NOT NULL AND vin <> '' GROUP BY vin HAVING COUNT(*) > 1) t;
 *   SELECT COUNT(*) FROM (SELECT plate_number FROM vehicles GROUP BY plate_number HAVING COUNT(*) > 1) t;
 */

/* VIN：非空时全局唯一 */
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_vin_unique
  ON public.vehicles (vin)
  WHERE vin IS NOT NULL AND vin <> '';

/* 车牌号：全局唯一且不可为空 */
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_number_unique
  ON public.vehicles (plate_number);
