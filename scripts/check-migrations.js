/* ============================================================
 * 迁移对账：仓库里的迁移文件 vs 数据库 migration_log 台账
 * 用途：部署前自查"哪些迁移文件写了但还没在数据库执行"，
 *       防"文件写了没执行"导致线上报错（诊断报告迁移管理专项）。
 *
 * 口径说明：台账制度 2026-08-29 才建立，之前的历史文件大多没登记
 * （不是没执行，是制度建立时没补登记）。所以分两个口径：
 *   - 2026-08-29 之后的文件：必须登记，漏登记 = 检查失败
 *   - 之前的历史文件：只列出提示，不影响退出码（待"基线化"时统一处理）
 * 用法：node scripts/check-migrations.js
 * 退出码：0 = 新制度以来的迁移账实相符；1 = 有未登记迁移 / 检查失败
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
  /* 1. 仓库里的迁移文件（supabase/migrations_*.sql 平铺体系） */
  const supabase目录 = path.join(__dirname, "..", "supabase");
  const 仓库文件 = fs
    .readdirSync(supabase目录)
    .filter((f) => /^migrations_.*\.sql$/.test(f))
    .sort();

  /* 2. 数据库台账（分页取全量） */
  const supabase = createClient(url, key);
  const 台账 = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("migration_log")
      .select("file_name")
      .range(from, from + 999);
    if (error) {
      console.error("❌ 读取 migration_log 失败: " + error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const 行 of data) 台账.add(行.file_name);
    if (data.length < 1000) break;
  }

  /* 3. 按台账制度建立日期（2026-08-29）分口径对账 */
  const 制度建立日 = "20260829";
  const 取日期 = (f) => (f.match(/^migrations_(\d{8})/) || [])[1] || "";
  const 未执行新制 = 仓库文件.filter((f) => !台账.has(f) && 取日期(f) >= 制度建立日);
  const 未执行历史 = 仓库文件.filter((f) => !台账.has(f) && 取日期(f) < 制度建立日);

  console.log(`仓库迁移文件: ${仓库文件.length} 个；台账登记: ${台账.size} 条\n`);

  if (未执行新制.length > 0) {
    console.log(`❌ 台账制度建立后仍未登记（${未执行新制.length} 个，大概率没执行过！）：`);
    for (const f of 未执行新制) console.log(`   - ${f}`);
    console.log("\n   处理：确认是否已在 Dashboard 执行；已执行则补登记台账，未执行先执行。");
    console.log("");
  }
  if (未执行历史.length > 0) {
    console.log(`ℹ️ 历史文件未登记台账（${未执行历史.length} 个，制度建立前的旧账，待基线化统一处理）`);
    console.log("");
  }
  if (未执行新制.length === 0) {
    console.log("✅ 台账制度建立以来的迁移全部已登记");
    return;
  }
  /* 用 exitCode 而非 process.exit：Windows 下直接 exit 时
     supabase-js 的 keep-alive 连接未关完会触发 libuv 断言崩溃，污染退出码 */
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("❌ 对账中止: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
