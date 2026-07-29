---
name: migration-check
description: 数据库迁移检查——新建或修改 supabase/migrations_*.sql 后使用。检查索引/RLS 规范，生成待粘贴到 Dashboard 的 SQL 清单，防止"迁移文件写了但没执行"导致线上报错。
---

# 数据库迁移检查技能

**背景**：本项目是云端 Supabase，迁移不走命令行，必须在 Dashboard SQL Editor 手动粘贴执行。已踩过坑：`inspection_video` 迁移文件写了但没执行，导致视频保存上线后失败。

## 触发时机

任何新建或修改 `supabase/migrations_*.sql` 的操作完成后，**必须**执行本检查。

## 执行步骤

### 第 1 步：规范检查

对待执行的迁移文件逐项检查，不符合的当场修复：

- [ ] **新建表必须同时创建索引**（外键字段、常用查询字段）
- [ ] **新建表必须启用 RLS 并创建策略**（`alter table xxx enable row level security`）
- [ ] **注释统一用 `/* */` 块注释**，禁止 `--` 行注释写中文长内容（Dashboard SQL Editor 会拆行导致执行失败）
- [ ] SQL 是幂等的更好（`if not exists` / `if exists`），重复执行不报错
- [ ] 删除字段/表前有注释说明关联业务已检查

### 第 2 步：生成"待执行清单"

用清晰的格式输出给用户，方便直接复制粘贴：

```
====================================
📋 待在 Supabase Dashboard 执行的迁移
====================================
文件：supabase/migrations_xxx.sql
操作路径：Supabase Dashboard → SQL Editor → 新建查询 → 粘贴 → Run

（完整 SQL 内容）
====================================
```

### 第 3 步：确认执行结果

- **如果配置了 Supabase MCP**：直接查询数据库验证表/字段是否真的建好了（如 `select column_name from information_schema.columns where table_name = 'xxx'`），验证通过才算完成
- **如果没配 MCP**：明确告诉用户"请粘贴执行后回复我一声，我再验证后续功能"，禁止默认用户已执行

### 第 4 步：依赖迁移的代码单独提醒

如果本次代码改动**依赖**新迁移（比如新字段写入），必须在汇报中突出警告：

> ⚠️ 本次代码依赖迁移 `migrations_xxx.sql`，**必须先执行迁移再部署代码**，否则线上会报错。

## 红线

- 禁止在迁移没确认执行前就部署依赖它的代码
- 禁止迁移文件里出现 `--` 中文长行注释
