/* ============================================================
 * 数据库导出存档（生产机运行，每月一次）
 * 把云端 Supabase 的核心业务表导出为 JSON 文件，存到本地存档目录。
 * 用途：云端之外的第二份数据保险。
 * 用法：node --env-file=.env.local scripts/backup-export.js
 * 建议 Windows 计划任务：每月 1 号凌晨跑一次
 * ============================================================ */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* 存档目录：优先环境变量，默认 D 盘 backup 目录 */
const 存档根目录 = process.env.BACKUP_DIR || "D:/autorepair-backup";

/* 核心表清单（按业务重要性排序；导出失败的表会跳过不中断） */
const 表清单 = [
  "customers", "vehicles", "work_orders", "work_order_requirements", "work_order_items",
  "work_order_item_parts", "parts", "part_batches", "inventory_logs",
  "purchase_orders", "purchase_order_items", "suppliers",
  "payments", "finance_transactions", "members", "member_transactions",
  "accounts_receivable", "accounts_payable", "profiles",
];

/* 单表分页全量导出（每页 1000 行，绕过 PostgREST 默认上限） */
async function 导出表(supabase, 表名) {
  const 全部 = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(表名)
      .select("*")
      .range(from, from + 999);
    if (error) throw new Error(`${表名}: ${error.message}`);
    if (!data || data.length === 0) break;
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

  console.log(`开始导出到 ${目录}\n`);
  const 失败 = [];
  for (const 表 of 表清单) {
    try {
      const 数据 = await 导出表(supabase, 表);
      fs.writeFileSync(path.join(目录, `${表}.json`), JSON.stringify(数据, null, 2), "utf8");
      console.log(`  ✅ ${表}: ${数据.length} 行`);
    } catch (err) {
      失败.push(表);
      console.log(`  ❌ ${表}: ${err.message}`);
    }
  }

  console.log(`\n完成：${表清单.length - 失败.length} 成功，${失败.length} 失败`);
  if (失败.length > 0) console.log("失败表: " + 失败.join(", "));

  /* 清理 90 天前的旧存档（保留最近 3 个月） */
  const  cutoff = Date.now() - 90 * 24 * 3600 * 1000;
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

main();
