/*
 * 数据库层唯一性约束（第一批：无冲突可直接加）
 * 背景：规范要求"数据库层 + 前端校验"双重保证，但这几张表一直只有前端校验。
 * 已确认无现存冲突：
 *   - customers.phone 排除"无手机号"占位后无重复
 *   - service_names.name 无重复
 *   - part_names.name 无重复
 * vehicles 的 vin/plate_number 约束等重复车辆清理完后再加（见 migrations_2026XXXX_vehicles_unique.sql）
 */

/* 客户手机号：非空且不是"无手机号"占位时全局唯一（部分唯一索引） */
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique
  ON public.customers (phone)
  WHERE phone IS NOT NULL AND phone <> '' AND phone <> '无手机号';

/* 维修项目名称唯一 */
CREATE UNIQUE INDEX IF NOT EXISTS service_names_name_unique
  ON public.service_names (name);

/* 配件名称唯一 */
CREATE UNIQUE INDEX IF NOT EXISTS part_names_name_unique
  ON public.part_names (name);
