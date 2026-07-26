/* ============================================================
 * 业务流程测试（写真实数据，全部自动清理）
 *
 *   B1 开工单全流程
 *   B2 新建车辆带 VIN（回归：此前填 VIN 保存必崩）
 *   B3 工单加需求弹窗
 *   B4 记一笔财务账
 *   B5 配件入库
 *
 * 所有测试数据都以"自动化"开头命名，结束后用 service key 精确清理。
 * 用法: npm run test:flows（账号环境变量同冒烟测试）
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

/* ---------- API 小工具 ---------- */
async function api(方法, 路径, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${路径}`, {
    method: 方法,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: 方法 === "POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (方法 === "POST" || 方法 === "GET") {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  }
  return res.ok;
}

/* ---------- 测试数据标识 ---------- */
const 随机尾 = String(Math.floor(Math.random() * 90000) + 10000);
const 客户名 = "自动化流程客户";
const 客户电话 = "198" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
const 车牌 = `黑T${随机尾}`;
const 测试VIN = `LFV2A21K4${随机尾}001`.slice(0, 17);
const 配件编号 = `TEST-${随机尾}`;
const 流水备注 = `自动化测试流水${随机尾}`;

const 结果 = [];
function 记录(步骤, 通过, 详情 = "") {
  结果.push({ 步骤, 通过 });
  console.log(`${通过 ? "✅" : "❌"} ${步骤}${详情 ? " — " + 详情 : ""}`);
}

/* ---------- 清理（无论成败都执行） ---------- */
async function 清理(工单id) {
  try {
    /* 1. 按名字找到全部测试客户，先删他们的工单链（防止某次失败留下的外键拦截） */
    const 客户们 = await api("GET", `customers?name=eq.${encodeURIComponent(客户名)}&select=id`);
    const 客户ids = (客户们 || []).map((c) => c.id);
    const 待删工单 = new Set();
    if (工单id) 待删工单.add(工单id);
    if (客户ids.length > 0) {
      const 工单们 = await api("GET", `work_orders?customer_id=in.(${客户ids.join(",")})&select=id`);
      for (const w of 工单们 || []) 待删工单.add(w.id);
    }
    for (const wid of 待删工单) {
      const 项目们 = await api("GET", `work_order_items?work_order_id=eq.${wid}&select=id`);
      for (const it of 项目们 || []) {
        await api("DELETE", `work_order_item_parts?work_order_item_id=eq.${it.id}`);
      }
      const 需求们 = await api("GET", `work_order_requirements?work_order_id=eq.${wid}&select=id`);
      for (const r of 需求们 || []) {
        await api("DELETE", `work_order_requirement_media?requirement_id=eq.${r.id}`);
      }
      await api("DELETE", `work_order_requirements?work_order_id=eq.${wid}`);
      await api("DELETE", `work_order_items?work_order_id=eq.${wid}`);
      await api("DELETE", `work_orders?id=eq.${wid}`);
    }
    /* 财务流水 */
    await api("DELETE", `finance_transactions?description=eq.${encodeURIComponent(流水备注)}`);
    /* 配件 */
    const parts = await api("GET", `parts?part_number=eq.${配件编号}&select=id,part_name_id`);
    for (const p of parts || []) {
      await api("DELETE", `part_batches?part_id=eq.${p.id}`);
      await api("DELETE", `inventory_logs?part_id=eq.${p.id}`);
      await api("DELETE", `parts?id=eq.${p.id}`);
      if (p.part_name_id) {
        const 名称行 = await api("GET", `part_names?id=eq.${p.part_name_id}&select=id,category_id`);
        await api("DELETE", `part_names?id=eq.${p.part_name_id}`);
        if (名称行?.[0]?.category_id) await api("DELETE", `part_categories?id=eq.${名称行[0].category_id}`);
      }
    }
    /* 车辆（本次的按车牌/VIN，历史残留按客户ID，先删车再删人才不被外键拦） */
    await api("DELETE", `vehicles?or=(plate_number.eq.${encodeURIComponent(车牌)},vin.eq.${测试VIN})`);
    if (客户ids.length > 0) {
      await api("DELETE", `vehicles?customer_id=in.(${客户ids.join(",")})`);
    }
    /* 客户 */
    await api("DELETE", `customers?name=eq.${encodeURIComponent(客户名)}`);
  } catch (e) {
    console.log("⚠️ 清理异常（不影响结果）:", e instanceof Error ? e.message : e);
  }
}

/* ---------- 主流程 ---------- */
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
let 工单id = "";
let 全部通过 = true;
function 断言(条件, 步骤, 详情 = "") {
  const 通过 = !!条件;
  if (!通过) 全部通过 = false;
  记录(步骤, 通过, 详情);
  return 通过;
}

try {
  await 清理(null); /* 先清上次残留 */

  /* 准备：客户 + 车辆（给 B1/B3 用） */
  const [客户] = await api("POST", "customers", { name: 客户名, phone: 客户电话 });
  await api("POST", "vehicles", { plate_number: 车牌, customer_id: 客户.id, brand: "测试品牌", model: "测试车型" });

  /* 登录 */
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-account", 账号);
  await page.fill("#login-password", 密码);
  await page.getByRole("button", { name: "登录", exact: true }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });

  /* ── B1 开工单 ── */
  await page.goto(`${BASE}/work-orders/new`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/输入车牌号搜索/).fill(车牌);
  await page.waitForTimeout(1500);
  await page.getByText(车牌, { exact: false }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /创建工单/ }).click();
  await page.waitForTimeout(4000);
  const b1文本 = await page.textContent("body");
  const b1网址 = page.url();
  断言(
    (b1网址.includes("/work-orders") && !b1网址.endsWith("/new")) || (b1文本 && b1文本.includes(车牌)),
    "B1 开工单全流程",
    b1网址
  );
  /* 从数据库取刚建的工单（后续 B3 用）：先查车辆再查工单 */
  const 车辆行 = await api("GET", `vehicles?plate_number=eq.${encodeURIComponent(车牌)}&select=id`);
  if (车辆行?.[0]?.id) {
    const 工单列表 = await api("GET", `work_orders?vehicle_id=eq.${车辆行[0].id}&select=id&order=created_at.desc&limit=1`);
    工单id = 工单列表?.[0]?.id || "";
  }
  断言(!!工单id, "B1 工单已写入数据库", 工单id);

  /* ── B2 新建车辆带 VIN ── */
  await page.goto(`${BASE}/vehicles/new`, { waitUntil: "domcontentloaded" });
  /* 选车主：输入客户名搜索 */
  await page.getByPlaceholder(/输入客户姓名搜索/).fill(客户名);
  await page.waitForTimeout(1500);
  await page.getByText(客户名, { exact: false }).first().click();
  await page.waitForTimeout(800);
  /* 车牌框是表单第一个文本框（初始值"黑"），VIN 用专用占位符 */
  const plateInput = page.locator('input[type="text"]').first();
  await plateInput.fill(车牌 + "V");
  await page.getByPlaceholder(/输入17位VIN码/).fill(测试VIN);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const b2车辆 = await api("GET", `vehicles?vin=eq.${测试VIN}&select=id,plate_number`);
  断言(Array.isArray(b2车辆) && b2车辆.length > 0, "B2 新建车辆带 VIN 保存成功", Array.isArray(b2车辆) && b2车辆.length > 0 ? 测试VIN : `未找到，URL=${page.url()}`);

  /* ── B3 工单加需求弹窗 ── */
  if (工单id) {
    await page.goto(`${BASE}/work-orders/${工单id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /添加需求|\+ ?需求/ }).first().click();
    /* 等弹窗真正出现再填 */
    await page.getByPlaceholder(/请输入客户需求/).waitFor({ state: "visible", timeout: 10000 });
    await page.getByPlaceholder(/请输入客户需求/).fill("自动化测试需求：刹车异响");
    await page.getByRole("button", { name: "保存" }).click();
    /* 等弹窗关闭（保存完成） */
    await page.getByPlaceholder(/请输入客户需求/).waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
    /* 以数据库为准验证保存成功（页面刷新快慢受当时负载影响，不作为判据） */
    let b3行 = [];
    for (let i = 0; i < 6; i++) {
      b3行 = await api("GET", `work_order_requirements?work_order_id=eq.${工单id}&select=id,description&order=created_at.desc&limit=1`);
      if (b3行?.[0]?.description?.includes("刹车异响")) break;
      await page.waitForTimeout(2000);
    }
    断言(b3行?.[0]?.description?.includes("刹车异响"), "B3 工单加需求弹窗保存", 工单id);
  }

  /* ── B4 记一笔财务账 ── */
  await page.goto(`${BASE}/finance/transactions/new`, { waitUntil: "domcontentloaded" });
  /* 等下拉选项异步加载完成（否则选完会被 React 重置回"请选择"） */
  await page.waitForFunction(() => {
    const sels = document.querySelectorAll("select");
    return sels.length >= 2 && sels[0].options.length > 1 && sels[1].options.length > 1;
  }, null, { timeout: 10000 });
  /* 账户、分类两个下拉都选第一个有效选项 */
  const 下拉们 = page.locator("select");
  const 下拉数 = await 下拉们.count();
  for (let i = 0; i < 下拉数; i++) {
    const 选项 = await 下拉们.nth(i).locator("option").allTextContents();
    const 有效 = 选项.find((t) => t.trim() && !t.includes("请选择"));
    if (有效) await 下拉们.nth(i).selectOption({ label: 有效.trim() });
  }
  await page.waitForTimeout(300);
  await page.getByPlaceholder("0.00").fill("12.34");
  /* 备注（textarea） */
  const 备注框 = page.locator("textarea").first();
  if (await 备注框.count()) await 备注框.fill(流水备注);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const b4流水 = await api("GET", `finance_transactions?description=eq.${encodeURIComponent(流水备注)}&select=id`);
  断言(Array.isArray(b4流水) && b4流水.length > 0, "B4 记一笔财务账", Array.isArray(b4流水) && b4流水.length > 0 ? 流水备注 : `未找到，URL=${page.url()}`);

  /* ── B5 配件入库 ── */
  const [分类行] = await api("POST", "part_categories", { name: `自动化测试分类${随机尾}` });
  const [配件名称行] = await api("POST", "part_names", { name: `自动化测试配件名称${随机尾}`, unit: "件", category_id: 分类行.id });
  const [配件] = await api("POST", "parts", { part_number: 配件编号, name: "自动化测试配件", quantity: 0, part_name_id: 配件名称行.id });
  await page.goto(`${BASE}/inventory/in`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/搜索配件编号/).fill(配件编号);
  await page.waitForTimeout(1500);
  await page.getByText(配件编号, { exact: false }).first().click();
  await page.waitForTimeout(500);
  /* 入库数量（"入库数量 *" 标签后的输入框） */
  await page.locator('label:has-text("入库数量") + input').first().fill("5");
  await page.getByRole("button", { name: /确认入库/ }).click();
  await page.waitForTimeout(4000);
  const b5配件 = await api("GET", `parts?part_number=eq.${配件编号}&select=quantity`);
  断言(b5配件?.[0]?.quantity === 5, "B5 配件入库 5 件", `库存=${b5配件?.[0]?.quantity}`);

} catch (err) {
  全部通过 = false;
  记录("执行中断", false, err instanceof Error ? err.message : String(err));
  try { await page.screenshot({ path: join(根目录, "smoke-test-failure.png"), fullPage: true }); console.log("已截图: smoke-test-failure.png"); } catch {}
} finally {
  await browser.close();
  await 清理(工单id);
}

console.log(`\n${全部通过 ? "✅ 业务流程测试全部通过" : "❌ 业务流程测试存在失败项"}`);
process.exit(全部通过 ? 0 : 1);
