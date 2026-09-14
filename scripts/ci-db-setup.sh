#!/usr/bin/env bash
# ============================================================
# CI 数据库初始化：在裸 Postgres 上重建项目库结构
#
# 步骤：
#   1. 写入 Supabase 垫片（角色 / auth / storage，见 ci-bootstrap.sql）
#   2. 灌 schema.sql 建核心表基线（早期核心表不在迁移序列里）
#   3. 按文件名字母序灌 migrations_*.sql（项目约定：字母序=开发序）
#   4. 灌 migrations/ 目录（Supabase CLI 格式的 3 个幂等补丁，
#      含 settle_work_order 等核心 RPC，放最后覆盖）
#
# 严格模式：任何一个文件报错立即中止（ON_ERROR_STOP=1 + set -e），
# 宁可 CI 红也不能带半个库跑测试。
#
# 用法：DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/ci-db-setup.sh
# ============================================================
set -euo pipefail

DB="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"

echo "== 1/4 写入 Supabase 垫片 =="
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/ci-bootstrap.sql

echo "== 2/4 灌 schema.sql（核心表基线） =="
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql

echo "== 3/4 按字母序灌 migrations_*.sql =="
count=0
while IFS= read -r f; do
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
  count=$((count + 1))
done < <(ls supabase/migrations_*.sql | LC_ALL=C sort)
echo "    已灌 $count 个迁移文件"

echo "== 4/4 灌 migrations/ 目录（CLI 格式，幂等补丁） =="
while IFS= read -r f; do
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done < <(ls supabase/migrations/*.sql | LC_ALL=C sort)

echo "== 数据库结构重建完成 =="
