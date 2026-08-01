/* ============================================================
 * 认证回归测试（登录态专项）
 *
 * 把历史上反复出现的登录态事故场景固化为自动化测试，
 * 任何涉及认证/session 的改动，改完必须跑本脚本：
 *   1. 登录成功（基线）
 *   2. 刷新页面后数据还在（事故回归：已登录用户刷新后数据为空）
 *   3. 软跳转进列表页数据正常（事故回归：点菜单进列表页空白、刷新才出来）
 *   4. 未登录访问受保护页 → 被重定向到登录页
 *   5. 退出登录后再访问受保护页 → 被重定向到登录页
 *
 * 用法：
 *   set SMOKE_ACCOUNT=19900001111
 *   set SMOKE_PASSWORD=测试账号密码
 *   npm run test:auth
 *
 * 账号只从环境变量读取，不写在代码里。
 * ============================================================ */

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const 根目录 = join(dirname(fileURLToPath(import.meta.url)), "..");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const 账号 = process.env.SMOKE_ACCOUNT;
const 密码 = process.env.SMOKE_PASSWORD;

if (!账号 || !密码) {
  console.error("❌ 缺少测试账号：请先设置环境变量 SMOKE_ACCOUNT 和 SMOKE_PASSWORD");
  console.error("   例: set SMOKE_ACCOUNT=19900001111 && set SMOKE_PASSWORD=你的密码 && npm run test:auth");
  process.exit(1);
}

/* ---------- 小工具 ---------- */
let 全部通过 = true;
function 断言(条件, 步骤, 详情 = "") {
  const 通过 = !!条件;
  if (!通过) 全部通过 = false;
  console.log(`${通过 ? "✅" : "❌"} ${步骤}${详情 ? " — " + 详情 : ""}`);
  return 通过;
}

const 页面错误 = [];

/* 登录并把页面停在工作台 */
async function 登录(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-account", 账号);
  await page.fill("#login-password", 密码);
  await page.getByRole("button", { name: "登录", exact: true }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (err) => 页面错误.push(String(err)));

try {
  /* ── 1. 登录（基线） ── */
  await 登录(page);
  断言(true, "登录成功", page.url());

  /* ── 2. 刷新页面后数据还在 ──
   * 事故回归：认证存储机制改动后，已登录用户刷新页面数据加载为空 */
  await page.goto(`${BASE}/work-orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const 刷新后文本 = await page.textContent("body");
  断言(
    刷新后文本 && (刷新后文本.includes("工单") || 刷新后文本.includes("暂无")),
    "刷新页面后工单列表数据还在"
  );
  断言(!page.url().includes("/login"), "刷新后没有被踢回登录页");

  /* ── 3. 软跳转进列表页数据正常 ──
   * 事故回归：点菜单软跳转进列表页数据为空，F5 刷新才出来。
   * 注意必须是真实点击导航链接（SPA 软跳转），不能 goto（goto 是整页加载） */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.getByRole("link", { name: "车型库", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith("/vehicle-models"), { timeout: 10000 });
  await page.waitForTimeout(3000);
  const 车型库文本 = await page.textContent("body");
  断言(
    车型库文本 && (车型库文本.includes("品牌") || 车型库文本.includes("车型") || 车型库文本.includes("暂无")),
    "软跳转：车型库数据正常"
  );
  断言(!page.url().includes("/login"), "软跳转后没有被踢回登录页");

  /* 再软跳转一次：车型库 → 客户预约，验证连续导航 session 不丢 */
  await page.getByRole("link", { name: "客户预约", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname.startsWith("/appointments"), { timeout: 10000 });
  await page.waitForTimeout(3000);
  const 预约文本 = await page.textContent("body");
  断言(
    预约文本 && (预约文本.includes("预约") || 预约文本.includes("暂无")),
    "连续软跳转：客户预约数据正常"
  );

  /* ── 4. 未登录访问受保护页 → 重定向登录页 ── */
  const 匿名上下文 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const 匿名页 = await 匿名上下文.newPage();
  await 匿名页.goto(`${BASE}/work-orders`, { waitUntil: "domcontentloaded" });
  await 匿名页.waitForTimeout(3000);
  断言(
    匿名页.url().includes("/login"),
    "未登录访问工单列表被重定向到登录页",
    匿名页.url()
  );
  await 匿名上下文.close();

  /* ── 5. 退出登录后再访问受保护页 → 重定向登录页 ── */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "退出登录", exact: true }).first().click();
  /* 确认弹窗（React 弹窗，点"确定退出"） */
  await page.getByRole("button", { name: "确定退出", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  断言(
    page.url().includes("/login"),
    "退出登录后访问客户列表被重定向到登录页",
    page.url()
  );
} catch (err) {
  全部通过 = false;
  断言(false, "执行中断", err instanceof Error ? err.message : String(err));
  try {
    await page.screenshot({ path: join(根目录, "auth-test-failure.png"), fullPage: true });
    console.log("已截图: auth-test-failure.png");
  } catch { /* 截图失败忽略 */ }
} finally {
  await browser.close();
}

/* ── 报告浏览器侧错误 ── */
if (页面错误.length > 0) {
  全部通过 = false;
  console.log("\n❌ 页面 JS 异常:");
  [...new Set(页面错误)].slice(0, 5).forEach((e) => console.log("   " + e));
}

console.log(`\n${全部通过 ? "✅ 认证回归测试全部通过" : "❌ 认证回归测试存在失败项"}`);
process.exit(全部通过 ? 0 : 1);
