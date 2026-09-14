/* ============================================================
 * 外键缺索引巡检：列出 public 下"有外键约束但没配索引"的列
 * 用途：外键列无索引会让按外键查明细/级联删除退化成全表扫描，
 *       表一大就卡。防同类缺口靠人记（2026-09-15 DeepSeek 诊断第 5 批）。
 * 前置：Supabase 后台已执行 migrations_20260915_c_notnull_fk_indexes.sql
 * 用法：node scripts/check-fk-indexes.js
 * 退出码：0 = 全部外键都有索引；1 = 有缺失或巡检失败
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
    if (process.env[名]) continue; /* 已注入的不覆盖 */
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
  const supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("list_unindexed_foreign_keys");

  if (error) {
    console.error("❌ 巡检失败:", error.message);
    console.error("   请确认已在 Supabase 后台执行 migrations_20260915_c_notnull_fk_indexes.sql");
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("✅ 全部外键列都已配索引");
    return;
  }

  console.log(`⚠️ 发现 ${data.length} 个外键列缺索引：`);
  for (const 行 of data) {
    console.log(`   - ${行.table_name}.${行.column_name}`);
  }
  console.log("\n补索引写法：CREATE INDEX IF NOT EXISTS idx_表名_列名 ON 表名(列名);");
  process.exit(1);
}

main();
