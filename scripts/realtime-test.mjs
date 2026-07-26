/* ============================================================
 * 实时同步测试（双浏览器）
 *
 * 场景：A、B 两人同时打开同一个工单详情页，
 * 第三方（模拟 A 在别处）改了配件价格，
 * B 的页面应该在几秒内自动更新、无需手动刷新。
 *
 * 用法: npm run test:realtime（账号环境变量同冒烟测试）
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

const 头 = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };
async function api(方法, 路径, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${路径}`, { method: 方法, headers: 头, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (!res.ok) console.log(`⚠️ API ${方法} ${路径} → ${res.status}:`, j.message || text.slice(0, 150));
    return j;
  } catch { return text; }
}

const 随机尾 = String(Math.floor(Math.random() * 90000) + 10000);
let 工单id = "";
let 配件id = "";

async function 清理() {
  try {
    /* 按名字找到所有测试客户，先删他们的工单链，再删客户（避免外键拦截） */
    const 客户们 = await api("GET", `customers?name=eq.${encodeURIComponent("自动化同步客户")}&select=id`);
    const 工单们 = await api("GET", `work_orders?customer_id=in.(${(客户们 || []).map((c) => c.id).join(",")})&select=id`);
    for (const wo of 工单们 || []) {
      const 项目们 = await api("GET", `work_order_items?work_order_id=eq.${wo.id}&select=id`);
      for (const it of 项目们 || []) {
        await api("DELETE", `work_order_item_parts?work_order_item_id=eq.${it.id}`);
      }
      await api("DELETE", `work_order_items?work_order_id=eq.${wo.id}`);
      await api("DELETE", `work_orders?id=eq.${wo.id}`);
    }
    await api("DELETE", `vehicles?plate_number=eq.黑S${随机尾}`);
    await api("DELETE", `customers?name=eq.${encodeURIComponent("自动化同步客户")}`);
  } catch { /* 忽略 */ }
}

const browser = await chromium.launch();
let 全部通过 = true;

try {
  await 清理();

  /* 准备数据：客户+车辆+工单+项目+配件(100元) */
  const [客户] = await api("POST", "customers", { name: "自动化同步客户", phone: "197" + 随机尾 + "000" });
  const [车辆] = await api("POST", "vehicles", { plate_number: `黑S${随机尾}`, customer_id: 客户.id });
  const [工单] = await api("POST", "work_orders", { vehicle_id: 车辆.id, customer_id: 客户.id, status: "received", order_type: "normal" });
  工单id = 工单.id;
  const [项目] = await api("POST", "work_order_items", { work_order_id: 工单id, name: "自动化同步项目", item_type: "labor", quantity: 1, unit_price: 100 });
  const [配件] = await api("POST", "work_order_item_parts", { work_order_item_id: 项目.id, name: "自动化同步配件", quantity: 1, unit_price: 100, unit_cost: 50, is_selected: true, customer_opinion: "agree" });
  配件id = 配件.id;
  console.log("测试工单:", 工单id);

  /* A、B 两个浏览器上下文同时打开详情页 */
  async function 打开页面() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`);
    await p.fill("#login-account", 账号);
    await p.fill("#login-password", 密码);
    await p.getByRole("button", { name: "登录", exact: true }).first().click();
    await p.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
    await p.goto(`${BASE}/work-orders/${工单id}`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2500);
    return p;
  }

  const 页面A = await 打开页面();
  const 页面B = await 打开页面();
  console.log("✅ A、B 两个页面已同时打开");

  /* 等两边的实时订阅都建立完成再改数据（订阅是异步握手，改早了一边会漏事件） */
  await 页面A.waitForTimeout(8000);

  /* 第三方改价：直接把配件单价 100 → 250 */
  await api("PATCH", `work_order_item_parts?id=eq.${配件id}`, { unit_price: 250 });
  console.log("✅ 已将配件单价改为 250（模拟另一人的操作）");

  /* B 应在 15 秒内自动更新（小计/合计区域的文字） */
  let b更新 = false;
  for (let i = 0; i < 15; i++) {
    const 文本 = await 页面B.textContent("body");
    if (文本 && /250(\.00)?/.test(文本)) { b更新 = true; break; }
    await 页面B.waitForTimeout(1000);
  }
  console.log(`${b更新 ? "✅" : "❌"} B 页面${b更新 ? "已自动更新为 250（实时同步生效）" : "15 秒内未更新"}`);
  if (!b更新) 全部通过 = false;

  /* A 页面同样应更新（两边一致性） */
  let a更新 = false;
  for (let i = 0; i < 5; i++) {
    const 文本 = await 页面A.textContent("body");
    if (文本 && /250(\.00)?/.test(文本)) { a更新 = true; break; }
    await 页面A.waitForTimeout(1000);
  }
  console.log(`${a更新 ? "✅" : "❌"} A 页面${a更新 ? "也同步为 250" : "未同步"}`);
  if (!a更新) 全部通过 = false;

} catch (err) {
  全部通过 = false;
  console.log("❌ 执行中断:", err instanceof Error ? err.message : err);
} finally {
  await browser.close();
  await 清理();
}

console.log(`\n${全部通过 ? "✅ 实时同步测试通过" : "❌ 实时同步测试失败"}`);
process.exit(全部通过 ? 0 : 1);
