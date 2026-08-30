# 数据库规范

## 表结构管理

- 数据库表结构通过 `supabase/migrations_*.sql` 手写 SQL 管理
- 新建表必须同时创建索引和 RLS 策略
- 删除数据前先检查关联业务数据，防止误删
- **迁移执行台账**：每次在 Dashboard 执行完迁移后，紧接着执行一行登记（表由 `migrations_20260829_migration_log.sql` 建立）：
  `INSERT INTO migration_log (file_name) VALUES ('migrations_YYYYMMDD_xxx.sql');`
  部署前用 `check-pending-migrations.js` + 台账双保险防"文件写了没执行"
- **同日多文件命名**：一天内多个迁移文件加 `_a/_b/_c` 或时分后缀（如 `migrations_20260820_a_xxx.sql`），保证字母序=开发序（0820 一天 6 个文件顺序雷的教训）
- 注释用 `/* */` 块注释，不用 `--` 行注释写中文长内容（Dashboard SQL Editor 会拆行报错）

## 数据唯一性约束（数据库层 + 前端校验需同时保证）

- 客户表：`phone` 可为空，非空时全局唯一
- 车辆表：`vin` 全局唯一（允许空值，非空值不可重复）
- 车辆表：`plate_number` 全局唯一，且不可为空
- 配件库存表（`parts`）：`part_number` 全局唯一，且不可为空
- 维修项目名称库（`service_names`）：`name` 全局唯一，且不可为空
- 配件名称库（`part_names`）：`name` 全局唯一，且不可为空

## 数据质量规范

- 字符串字段提交前统一 `trim()`，为空时传 `NULL`（不存空字符串）
- 数字字段（价格、数量等）未填写时传 `NULL`，`0` 表示实际值为 0
- 金额计算注意 JavaScript 浮点数精度问题，关键运算建议先转整数分处理

## 文件上传

- 图片上传前统一压缩至 **300KB** 以内，使用 `src/lib/imageCompress.ts`
- 视频不上传原文件、前端不压缩，限制单个不超过 **100MB**、时长不超过 **60 秒**
