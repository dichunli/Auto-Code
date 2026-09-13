/* ============================================================
 * RLS 巡检：列出 public 下所有没开行级权限的表
 * 用途：防止"建了策略却忘了开开关"这类漏开（2026-09-12 诊断发现
 *       employee_groups 漏开 5 个月，期间谁都能读写）。
 * 前置：Supabase 后台已执行 migrations_20260913_a_employee_groups_rls.sql
 * 用法：node scripts/check-rls-status.js
 * 退出码：0 = 全部表已开 RLS；1 = 有漏开表或巡检失败
 * ============================================================ */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

/* 自动加载项目根目录的 .env.local */
(function 加载本地环境变量() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const 行 of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const 匹配 = 行.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!匹配) continue;
    const [, 名, 原始值] = 匹配;
    if (process.env[名]) continue;
    process.env[名] = 原始值.replace(/^["']|["']$/g, "");
  }
})();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function main() {
  /* 巡检函数要求登录身份，用 service_role 换取一个有效调用上下文：
     list_tables_without_rls 只读元数据，不碰业务数据 */
  const supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("list_tables_without_rls");

  if (error) {
    console.error("❌ 巡检失败: " + error.message);
    console.error("   请确认已在 Supabase 后台执行 migrations_20260913_a_employee_groups_rls.sql");
    process.exit(1);
  }

  const 漏开表 = (data || []).map((r) => r.table_name);
  if (漏开表.length === 0) {
    console.log("✅ public 下所有表均已开启 RLS");
    return;
  }

  console.log(`❌ 发现 ${漏开表.length} 张表未开启 RLS：`);
  for (const 表 of 漏开表) console.log(`   - ${表}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("❌ 巡检中止: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
