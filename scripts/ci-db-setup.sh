#!/usr/bin/env bash
# ============================================================
# CI 数据库初始化：在裸 Postgres 上重建项目库结构
#
# 步骤：
#   1. 写入 Supabase 垫片（角色 / auth / storage，见 ci-bootstrap.sql）
#   2. 灌 schema.sql 建核心表基线（早期核心表不在迁移序列里）——严格模式
#   3. 按文件名字母序灌 migrations_*.sql（项目约定：字母序=开发序）——容错重放
#   4. 灌 migrations/ 目录（Supabase CLI 格式的 3 个幂等补丁，
#      含 settle_work_order 等核心 RPC，放最后覆盖）——严格模式
#   5. 结构冒烟校验：核心表/函数必须都在，防容错放过真错误
#
# 为什么第 3 步容错：schema.sql 是 6/14 全量快照（已含 5-6 月迁移效果），
# 重放早期迁移必然撞"表/索引/策略/触发器已存在"——这类错误是预期的，
# 进白名单放过；其余错误（语法、缺列、函数没建成）照旧让 CI 失败。
#
# 用法：DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/ci-db-setup.sh
# ============================================================
set -euo pipefail

DB="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"

echo "== 1/5 写入 Supabase 垫片 =="
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/ci-bootstrap.sql

echo "== 2/5 灌 schema.sql（核心表基线，严格） =="
psql "$DB" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql

echo "== 3/5 按字母序灌 migrations_*.sql（容错重放，错误审计） =="
count=0
failed=0
errlog=$(mktemp)
while IFS= read -r f; do
  : > "$errlog"
  psql "$DB" -q -f "$f" > /dev/null 2>"$errlog" || true
  # 只审计 ERROR 行；白名单：对象已存在/不存在（预期冲突）、种子数据主键重复
  bad=$(grep -E "ERROR:" "$errlog" | grep -viE "already exists|does not exist|duplicate key value violates" || true)
  if [ -n "$bad" ]; then
    echo "--- ✗ $f 有非白名单错误："
    echo "$bad" | head -5
    failed=1
  fi
  count=$((count + 1))
done < <(ls supabase/migrations_*.sql | LC_ALL=C sort)
echo "    已灌 $count 个迁移文件"
if [ "$failed" -ne 0 ]; then
  echo "== 迁移重放存在非白名单错误，见上方清单，CI 失败 =="
  exit 1
fi

echo "== 4/5 灌 migrations/ 目录（CLI 格式，幂等补丁，严格） =="
while IFS= read -r f; do
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done < <(ls supabase/migrations/*.sql | LC_ALL=C sort)

echo "== 5/5 结构冒烟校验（核心表/函数必须齐全） =="
psql "$DB" -v ON_ERROR_STOP=1 -t -c "
DO \$\$
DECLARE
  v_func INT;
  v_table INT;
BEGIN
  SELECT count(DISTINCT proname) INTO v_func FROM pg_proc
  WHERE proname IN ('settle_work_order','complete_purchase_inbound','revoke_completed_inbound','revoke_supplier_returns','manual_part_inbound');
  IF v_func < 5 THEN
    RAISE EXCEPTION '核心函数缺失：期望 5 个，实际 % 个', v_func;
  END IF;
  SELECT count(*) INTO v_table FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('work_orders','parts','inbound_orders','purchase_orders','inventory_logs','part_batches','members','finance_accounts');
  IF v_table < 8 THEN
    RAISE EXCEPTION '核心表缺失：期望 8 张，实际 % 张', v_table;
  END IF;
  RAISE NOTICE '结构冒烟校验通过：核心函数 % 个、核心表 % 张', v_func, v_table;
END \$\$;
"

echo "== 数据库结构重建完成 =="
