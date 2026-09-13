/* ============================================================
 * 手机号/VIN 部分唯一索引修复（2026-09-13）
 *
 * 背景（诊断发现）：8-13 想建的"排除空值和占位串"部分唯一索引，
 * 因与 5 月旧约束同名 + IF NOT EXISTS 被静默跳过，语义从未生效——
 * 后果：多个客户的手机号都填占位串"无手机号"时，会撞 5 月的全量唯一约束报错。
 *
 * 前置已验证：2026-09-13 跑 scripts/find-duplicates.js 确认
 * 重复手机号/车牌/VIN 均为 0 组，可安全重建。
 *
 * 做法：先彻底删除旧同名对象（约束/索引都删），再建部分唯一索引，
 * 不再用 IF NOT EXISTS（避免再次静默跳过）。
 * ============================================================ */

/* 客户手机号：非空且非占位串时全局唯一 */
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_phone_unique;
DROP INDEX IF EXISTS public.customers_phone_unique;
CREATE UNIQUE INDEX customers_phone_unique
  ON public.customers (phone)
  WHERE phone IS NOT NULL AND phone <> '' AND phone <> '无手机号';

/* 车辆 VIN：允许空值，非空全局唯一 */
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_vin_unique;
DROP INDEX IF EXISTS public.vehicles_vin_unique;
CREATE UNIQUE INDEX vehicles_vin_unique
  ON public.vehicles (vin)
  WHERE vin IS NOT NULL AND vin <> '';
