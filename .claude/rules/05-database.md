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

## 函数权限规范（2026-09-01 踩坑后新增）

- **收回函数执行权限必须连 PUBLIC 一起收**：函数创建时默认带 PUBLIC 授权，PostgreSQL 里 PUBLIC 对所有角色生效，只写 `REVOKE ... FROM anon` 等于白收。正确写法：业务函数 `FROM PUBLIC, anon`；触发器/内部函数 `FROM PUBLIC, anon, authenticated`
- **权限验证必须用 `has_function_privilege`**：收完权限后用 `has_function_privilege('anon', oid, 'EXECUTE')` 验证真实生效权限，禁止只看 `proacl` 文本里有没有 `anon=X`（那样会漏掉 PUBLIC 暗道，出现"收了但没真收到"）
- **新建函数顺手收 PUBLIC**：迁移文件里 `CREATE FUNCTION` 后固定跟一句收回 PUBLIC 执行权，从根上不留默认开口
- **重载函数按签名逐个收**：用 `oidvectortypes(proargtypes)` 自动展开每个重载签名，防止漏收（参考 `migrations_20260901_function_revoke_public.sql`）

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
