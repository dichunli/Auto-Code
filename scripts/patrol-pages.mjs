/* ============================================================
 * 全页面巡检（只读，不写数据）
 *
 * 打开系统所有页面，检查：
 *   1. 没有 JS 异常（pageerror）
 *   2. 页面不是空白/500/错误边界
 *   3. HTTP 状态正常
 *
 * 动态路由 [id] 自动从数据库取真实记录替换；查不到数据的页面标记跳过。
 * 用法: npm run test:patrol（账号环境变量同冒烟测试）
 * ============================================================ */

import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const 根目录 = join(dirname(fileURLToPath(import.meta.url)), "..");
function 读env文件() {
  const env = {};
  try {
    for (const 行 of readFileSync(join(根目录, ".env.local"), "utf-8").split(/\r?\n/)) {
      const m = 行.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* 忽略 */ }
  return env;
}
const env文件 = 读env文件();
const SUPABASE_URL = env文件.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env文件.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const 账号 = process.env.SMOKE_ACCOUNT;
const 密码 = process.env.SMOKE_PASSWORD;
if (!账号 || !密码) { console.error("❌ 缺 SMOKE_ACCOUNT / SMOKE_PASSWORD"); process.exit(1); }

/* ---------- 取各表一条真实 ID（用于替换动态路由） ---------- */
async function 取ID(表, 字段 = "id") {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${表}?select=${字段}&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const rows = await res.json();
    return rows?.[0]?.[字段] || null;
  } catch { return null; }
}

/* [表名, 路由前缀] —— 前缀命中即用该表 id 替换 */
const 动态路由表 = [
  ["/appointments/", "appointments"],
  ["/companies/", "companies"],
  ["/customers/", "customers"],
  ["/employees/", "profiles"],
  ["/finance/other/", "finance_other"],
  ["/finance/other-categories/", "finance_other_categories"],
  ["/follow-ups/", "follow_ups"],
  ["/inbound-orders/", "inbound_orders"],
  ["/knowledge/", "knowledge_articles"],
  ["/mechanic-levels/", "mechanic_levels"],
  ["/members/", "members"],
  ["/parts/", "parts"],
  ["/part-brands/", "part_brands"],
  ["/part-categories/", "part_categories"],
  ["/part-names/", "part_names"],
  ["/part-specifications/", "part_specifications"],
  ["/procurement/", "purchase_orders"],
  ["/reminders/", "maintenance_reminders"],
  ["/return-orders/", "purchase_return_orders"],
  ["/service-categories/", "service_categories"],
  ["/service-items/", "service_items"],
  ["/service-names/", "service_names"],
  ["/suppliers/", "suppliers"],
  ["/tools/management/", "tools"],
  ["/training/categories/", "training_categories"],
  ["/training/", "training_courses"],
  ["/vehicles/", "vehicles"],
  ["/work-orders/", "work_orders"],
];

/* ---------- 收集路由 ---------- */
import { readdirSync, statSync, existsSync } from "fs";
function 收集路由(dir, prefix = "") {
  const 路由 = [];
  for (const name of readdirSync(dir)) {
    const 全路径 = join(dir, name);
    if (!statSync(全路径).isDirectory()) continue;
    if (name.startsWith("(") || name === "api") continue;
    const 路由前缀 = prefix + "/" + name;
    if (existsSync(join(全路径, "page.tsx"))) 路由.push(路由前缀 === "/" ? "/" : 路由前缀);
    路由.push(...收集路由(全路径, 路由前缀));
  }
  return 路由;
}

const 所有路由 = 收集路由(join(根目录, "src/app"))
  .filter((r) => r !== "/login")
  .sort();

console.log(`共发现 ${所有路由.length} 个页面路由\n`);

/* ---------- 主流程 ---------- */
const browser = await chromium.launch();
const 失败列表 = [];
const 跳过列表 = [];
let 通过数 = 0;

const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);

/* 登录 */
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill("#login-account", 账号);
await page.fill("#login-password", 密码);
await page.getByRole("button", { name: "登录", exact: true }).first().click();
await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
console.log("✅ 登录成功，开始巡检\n");

for (const 路由 of 所有路由) {
  let 实际路由 = 路由;
  let 表名 = null;
  if (路由.includes("[")) {
    /* 取路由中第一个动态段的前缀查表 */
    const 匹配 = 动态路由表.find(([前缀]) => 路由.startsWith(前缀));
    if (匹配) {
      表名 = 匹配[1];
      const id = await 取ID(表名);
      if (!id) {
        跳过列表.push(`${路由}（${表名} 表无数据）`);
        console.log(`⏭️  ${路由} — 跳过（无数据）`);
        continue;
      }
      实际路由 = 路由.replace(/\[[^\]]+\]/g, String(id));
    } else {
      跳过列表.push(`${路由}（未知动态路由）`);
      console.log(`⏭️  ${路由} — 跳过（未知动态段）`);
      continue;
    }
  }

  const 页面错误 = [];
  const 监听器 = (err) => 页面错误.push(String(err));
  page.on("pageerror", 监听器);
  try {
    const resp = await page.goto(`${BASE}${实际路由}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);
    const 状态 = resp?.status() || 0;
    const 文本 = (await page.textContent("body")) || "";
    const 是崩溃页 = 文本.includes("Internal Server Error") || 文本.includes("Application error");
    const 是空白 = 文本.trim().length < 20;

    if (页面错误.length > 0) {
      失败列表.push(`${实际路由} — JS异常: ${页面错误[0].slice(0, 150)}`);
      console.log(`❌ ${实际路由} — JS异常: ${页面错误[0].slice(0, 100)}`);
    } else if (状态 >= 500 || 是崩溃页) {
      失败列表.push(`${实际路由} — 服务端错误(${状态})`);
      console.log(`❌ ${实际路由} — 服务端错误(${状态})`);
    } else if (状态 === 404) {
      失败列表.push(`${实际路由} — 404`);
      console.log(`❌ ${实际路由} — 404`);
    } else if (是空白) {
      失败列表.push(`${实际路由} — 空白页`);
      console.log(`❌ ${实际路由} — 空白页`);
    } else {
      通过数++;
      console.log(`✅ ${实际路由}`);
    }
  } catch (err) {
    失败列表.push(`${实际路由} — 加载超时/异常: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
    console.log(`❌ ${实际路由} — ${err instanceof Error ? err.message.slice(0, 80) : err}`);
  } finally {
    page.off("pageerror", 监听器);
  }
}

await browser.close();

console.log(`\n════════ 巡检结果 ════════`);
console.log(`✅ 通过: ${通过数}  ❌ 失败: ${失败列表.length}  ⏭️ 跳过: ${跳过列表.length}`);
if (跳过列表.length > 0) console.log("\n跳过（无数据/未映射）:\n" + 跳过列表.map((s) => "  ⏭️ " + s).join("\n"));
if (失败列表.length > 0) {
  console.log("\n失败明细:\n" + 失败列表.map((s) => "  ❌ " + s).join("\n"));
  process.exit(1);
}
console.log("\n✅ 全部页面巡检通过");
process.exit(0);
