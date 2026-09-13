/* ============================================================
 * 数据库导出存档（生产机运行，建议每天一次）
 * 把云端 Supabase 的全部 public 表导出为 JSON 文件，存到本地存档目录。
 * 用途：云端之外的第二份数据保险。
 *
 * 2026-09-12 大修（诊断发现旧版两个致命问题）：
 *  1. 表清单不再写死——从 PostgREST 根接口动态获取全库表清单，
 *     以后新建的表自动纳入，杜绝"加了新表忘了补清单"
 *     （旧清单只有 19 张表，而库里实际有 160+ 张，采购/考核/知识库全没备份）
 *  2. 任何一张表导出失败 → 整体以非零码退出，让 backup.bat 中止打包，
 *     杜绝"看起来成功、其实没数据"的假备份
 *
 * 用法：node scripts/backup-export.js [目标目录]
 *   目标目录缺省读环境变量 BACKUP_DIR，再缺省 D:/autorepair-backup
 *   密钥自动读项目根目录 .env.local（也可提前用环境变量注入）
 * ============================================================ */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

/* 自动加载项目根目录的 .env.local（backup.bat 直接调 node 时环境变量不会带进来） */
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
  console.error("❌ 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（.env.local 里应有配置）");
  process.exit(1);
}

/* 存档目录：命令行参数 > 环境变量 > 默认 D 盘 */
const 存档根目录 = process.argv[2] || process.env.BACKUP_DIR || "D:/autorepair-backup";

/* 从 PostgREST 根接口的接口文档里取全库表清单（/rpc/ 是函数不是表，排除） */
async function 获取全库表清单() {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`获取表清单失败: HTTP ${res.status}`);
  const 文档 = await res.json();
  return Object.keys(文档.paths || {})
    .filter((p) => p.startsWith("/") && !p.startsWith("/rpc/"))
    .map((p) => p.slice(1))
    .filter(Boolean)
    .sort();
}

/* 单表分页全量导出（每页 1000 行，绕过 PostgREST 默认上限）。
 * 每页请求带 60 秒超时 + 最多重试 3 次：
 * 2026-09-12 实测遇到网络闪断时请求会一直挂起，备份进程假死数小时，
 * 既不成功也不报错——宁可重试后明确失败，也不能无声卡死。 */
async function 拉一页(supabase, 表名, from) {
  let 最后错误 = null;
  for (let 第几次 = 1; 第几次 <= 3; 第几次++) {
    try {
      const 查询 = supabase.from(表名).select("*").range(from, from + 999);
      const { data, error } = await Promise.race([
        查询,
        new Promise((_, reject) => setTimeout(() => reject(new Error("请求超时(60秒)")), 60000)),
      ]);
      if (error) throw new Error(error.message);
      return data || [];
    } catch (err) {
      最后错误 = err;
      console.log(`  … ${表名} 第 ${from} 行起拉取失败（第 ${第几次} 次）: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw 最后错误;
}

async function 导出表(supabase, 表名) {
  const 全部 = [];
  for (let from = 0; ; from += 1000) {
    const data = await 拉一页(supabase, 表名, from);
    if (data.length === 0) break;
    全部.push(...data);
    if (data.length < 1000) break;
  }
  return 全部;
}

async function main() {
  const supabase = createClient(url, key);
  const 日期 = new Date().toISOString().slice(0, 10);
  const 目录 = path.join(存档根目录, 日期);
  fs.mkdirSync(目录, { recursive: true });

  const 表清单 = await 获取全库表清单();
  console.log(`开始导出到 ${目录}，共 ${表清单.length} 张表\n`);

  const 失败 = [];
  const 行数台账 = [];
  for (const 表 of 表清单) {
    try {
      const 数据 = await 导出表(supabase, 表);
      fs.writeFileSync(path.join(目录, `${表}.json`), JSON.stringify(数据), "utf8");
      行数台账.push(`${表}\t${数据.length}`);
      console.log(`  ✅ ${表}: ${数据.length} 行`);
    } catch (err) {
      失败.push(`${表}(${err.message})`);
      console.log(`  ❌ ${表}: ${err.message}`);
    }
  }

  /* 写一份行数台账，恢复演练/抽查备份完整性时对照用 */
  fs.writeFileSync(path.join(目录, "_行数台账.txt"), 行数台账.join("\n") + "\n", "utf8");

  console.log(`\n完成：${表清单.length - 失败.length} 成功，${失败.length} 失败`);
  if (失败.length > 0) {
    console.error("失败表: " + 失败.join(", "));
    console.error("❌ 有表导出失败，本次备份不完整，整体视为失败！");
    process.exit(1);
  }

  /* 清理 90 天前的旧存档（保留最近 3 个月） */
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  for (const 名 of fs.readdirSync(存档根目录)) {
    const 子目录 = path.join(存档根目录, 名);
    try {
      if (fs.statSync(子目录).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(名)) {
        if (new Date(名).getTime() < cutoff) {
          fs.rmSync(子目录, { recursive: true, force: true });
          console.log(`清理旧存档: ${名}`);
        }
      }
    } catch { /* 忽略 */ }
  }
}

main().catch((err) => {
  console.error("❌ 备份导出中止: " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
