/* ============================================================
 * 重复数据查重（只读，不写库）
 * 用途：customers.phone / vehicles.vin / vehicles.plate_number 建唯一索引前，
 *       必须先清理重复数据——本脚本拉出全部重复清单供人工拍板。
 * 用法：node scripts/find-duplicates.js
 * ============================================================ */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

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

async function 全量拉取(supabase, 表, 列) {
  const 全部 = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(表).select(列).range(from, from + 999);
    if (error) throw new Error(`${表}: ${error.message}`);
    if (!data || data.length === 0) break;
    全部.push(...data);
    if (data.length < 1000) break;
  }
  return 全部;
}

function 找重复(行们, 取值) {
  const 按值 = new Map();
  for (const 行 of 行们) {
    const 值 = 取值(行);
    if (!值) continue;
    if (!按值.has(值)) 按值.set(值, []);
    按值.get(值).push(行);
  }
  return [...按值.entries()].filter(([, 们]) => 们.length > 1);
}

async function main() {
  const supabase = createClient(url, key);
  const 报告行 = [];

  /* ── 客户手机号（口径：排除 NULL/空串/'无手机号' 占位） ── */
  const 客户们 = await 全量拉取(supabase, "customers", "id, name, phone, created_at");
  const 有效手机 = (c) => {
    const p = (c.phone || "").trim();
    return p && p !== "无手机号" ? p : null;
  };
  const 重复手机 = 找重复(客户们, 有效手机);

  报告行.push(`# 重复数据查重报告（${new Date().toISOString().slice(0, 10)}）\n`);
  报告行.push(`## 客户手机号（共 ${客户们.length} 个客户）\n`);
  if (重复手机.length === 0) {
    报告行.push("✅ 无重复手机号，可以直接建唯一索引\n");
  } else {
    报告行.push(`❌ ${重复手机.length} 组重复：\n`);
    for (const [手机, 们] of 重复手机) {
      报告行.push(`### ${手机}（${们.length} 个客户）`);
      for (const c of 们) 报告行.push(`- ${c.name || "(无名)"}  id=${c.id}  建档=${(c.created_at || "").slice(0, 10)}`);
      报告行.push("");
    }
  }

  /* ── 车牌号 ── */
  const 车辆们 = await 全量拉取(supabase, "vehicles", "id, plate_number, vin, brand, model, created_at");
  const 重复车牌 = 找重复(车辆们, (v) => (v.plate_number || "").trim() || null);
  报告行.push(`\n## 车牌号（共 ${车辆们.length} 辆车）\n`);
  if (重复车牌.length === 0) {
    报告行.push("✅ 无重复车牌\n");
  } else {
    报告行.push(`❌ ${重复车牌.length} 组重复：\n`);
    for (const [牌, 们] of 重复车牌) {
      报告行.push(`### ${牌}（${们.length} 辆）`);
      for (const v of 们) 报告行.push(`- ${v.brand || ""}${v.model || ""}  id=${v.id}  建档=${(v.created_at || "").slice(0, 10)}`);
      报告行.push("");
    }
  }

  /* ── VIN（口径：排除 NULL/空串） ── */
  const 重复VIN = 找重复(车辆们, (v) => (v.vin || "").trim() || null);
  报告行.push("\n## VIN\n");
  if (重复VIN.length === 0) {
    报告行.push("✅ 无重复 VIN，可以直接建唯一索引\n");
  } else {
    报告行.push(`❌ ${重复VIN.length} 组重复：\n`);
    for (const [vin, 们] of 重复VIN) {
      报告行.push(`### ${vin}（${们.length} 辆）`);
      for (const v of 们) 报告行.push(`- ${v.plate_number} ${v.brand || ""}${v.model || ""}  id=${v.id}  建档=${(v.created_at || "").slice(0, 10)}`);
      报告行.push("");
    }
  }

  /* 详细清单只写本地文件（含真实姓名/手机号，不进对话、不上传任何地方），
     控制台只输出数量。用完后可自行删除该文件。 */
  const 报告路径 = path.join(__dirname, "..", "查重报告.md");
  fs.writeFileSync(报告路径, 报告行.join("\n"), "utf8");

  const 总组数 = 重复手机.length + 重复车牌.length + 重复VIN.length;
  console.log(`客户 ${客户们.length} 个 / 车辆 ${车辆们.length} 辆`);
  console.log(`重复手机号: ${重复手机.length} 组；重复车牌: ${重复车牌.length} 组；重复 VIN: ${重复VIN.length} 组`);
  console.log(总组数 === 0 ? "✅ 三项全部干净，唯一索引可以直接建" : `详细清单已写入: ${报告路径}（看完处理完记得删）`);
}

main().catch((err) => {
  console.error("❌ 查重中止: " + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
