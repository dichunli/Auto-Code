/* ============================================================
 * 冒烟测试（部署后自动验证核心功能）
 *
 * 覆盖规范要求的三个核心功能 + 近期修过的页面回归：
 *   1. 登录（测试账号能登录成功）
 *   2. 工单列表（能打开、正常渲染）
 *   3. 数据保存（创建测试客户 → 列表能搜到 → 自动清理）
 *   4. 知识库能打开（历史事故回归）
 *   5. 晋级总览页能加载（历史 bug 回归）
 *
 * 用法：
 *   set SMOKE_ACCOUNT=19900001111
 *   set SMOKE_PASSWORD=测试账号密码
 *   npm run test:smoke
 *
 * 账号只从环境变量读取，不写在代码里。
 * ============================================================ */

import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/* ---------- 读取 .env.local（拿 Supabase 地址和 service key 用于清理测试数据） ---------- */
const 根目录 = join(dirname(fileURLToPath(import.meta.url)), "..");
function 读env文件() {
  try {
    const 内容 = readFileSync(join(根目录, ".env.local"), "utf-8");
    const env = {};
    for (const 行 of 内容.split(/\r?\n/)) {
      const m = 行.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return env;
  } catch {
    return {};
  }
}
const env文件 = 读env文件();
const SUPABASE_URL = env文件.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env文件.SUPABASE_SERVICE_ROLE_KEY;

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const 账号 = process.env.SMOKE_ACCOUNT;
const 密码 = process.env.SMOKE_PASSWORD;

if (!账号 || !密码) {
  console.error("❌ 缺少测试账号：请先设置环境变量 SMOKE_ACCOUNT 和 SMOKE_PASSWORD");
  console.error("   例: set SMOKE_ACCOUNT=19900001111 && set SMOKE_PASSWORD=你的密码 && npm run test:smoke");
  process.exit(1);
}

/* ---------- 小工具 ---------- */
const 结果 = [];
function 记录(步骤, 通过, 详情 = "") {
  结果.push({ 步骤, 通过, 详情 });
  console.log(`${通过 ? "✅" : "❌"} ${步骤}${详情 ? " — " + 详情 : ""}`);
}

const 页面错误 = [];
const 控制台错误 = [];

/* 测试客户资料：随机虚拟手机号，避免撞唯一约束 */
const 测试手机号 = "199" + String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
const 测试客户名 = "自动化测试客户";

/* 用 service key 直接删测试客户（只删名字完全匹配的，绝不动真实数据） */
async function 清理测试客户() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/customers?name=eq.${encodeURIComponent(测试客户名)}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  } catch { /* 清理失败不影响测试结果 */ }
}

/* ---------- 主流程 ---------- */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(30000);
page.on("pageerror", (err) => 页面错误.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") 控制台错误.push(msg.text());
});

let 全部通过 = true;
function 断言(条件, 步骤, 详情 = "") {
  const 通过 = !!条件;
  if (!通过) 全部通过 = false;
  记录(步骤, 通过, 详情);
  return 通过;
}

try {
  /* 先清掉上次可能残留的测试客户 */
  await 清理测试客户();

  /* ── 1. 登录 ── */
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-account", 账号);
  await page.fill("#login-password", 密码);
  await page.getByRole("button", { name: "登录", exact: true }).first().click();
  /* 卡顿环境下首页资源多、load 事件慢：只等 URL 变化 + DOM 就绪，不等全部资源（最长 45 秒） */
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45000, waitUntil: "domcontentloaded" });
  断言(true, "登录成功", page.url());

  /* ── 2. 工单列表 ── */
  await page.goto(`${BASE}/work-orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000); /* 等首屏数据渲染 */
  const 工单页文本 = await page.textContent("body");
  /* 注意：不检查 "error" 字样——Next.js 的 RSC 数据流里天然含 "error" 键名，会误报 */
  断言(
    工单页文本 && (工单页文本.includes("工单") || 工单页文本.includes("暂无")),
    "工单列表能打开"
  );

  /* ── 3. 知识库（历史事故回归） ── */
  await page.goto(`${BASE}/knowledge`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const 知识库文本 = await page.textContent("body");
  断言(
    知识库文本 && (知识库文本.includes("知识") || 知识库文本.includes("文章") || 知识库文本.includes("暂无")),
    "知识库能打开"
  );

  /* ── 4. 晋级总览页（历史 bug 回归：之前加载到一半就断） ── */
  await page.goto(`${BASE}/training/promotion-overview`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const 晋级页文本 = await page.textContent("body");
  断言(
    晋级页文本 && (晋级页文本.includes("晋级") || 晋级页文本.includes("等级") || 晋级页文本.includes("暂无")),
    "晋级总览页能加载"
  );

  /* ── 5. 数据保存：创建客户 → 列表搜到 → 清理 ── */
  await page.goto(`${BASE}/customers/new`, { waitUntil: "domcontentloaded" });
  await page.locator('label:has-text("客户姓名") + input').first().fill(测试客户名);
  /* 勾选"有手机号"再填号码（主手机号框是 type=tel 无 placeholder） */
  const hasPhoneBox = page.locator("#hasPhone");
  if (await hasPhoneBox.count()) {
    if (!(await hasPhoneBox.isChecked())) await hasPhoneBox.check();
    await page.locator('input[type="tel"]').first().fill(测试手机号);
  }
  await page.locator('button[type="submit"]').first().click();
  /* 等保存跳转到客户列表：卡顿环境下固定等待不可靠，以 URL 变化为准（最长 30 秒） */
  await page.waitForURL("**/customers", { timeout: 30000 });

  /* 回客户列表按手机号搜索验证（搜索是按钮触发，非防抖自动搜） */
  await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
  const 电话搜索框 = page.getByPlaceholder("联系电话");
  if (await 电话搜索框.count()) {
    await 电话搜索框.fill(测试手机号);
    await page.getByRole("button", { name: "搜索", exact: true }).first().click();
    await page.waitForTimeout(3000); /* 等搜索结果渲染 */
  }
  /* 卡顿环境下服务端查询慢：不用固定等待+抓静态文本，改为等"含客户名的行"出现（自动等待最长 30 秒） */
  let 找到客户 = true;
  try {
    await page.waitForSelector(`main table tbody >> text=${测试客户名}`, { timeout: 30000 });
  } catch {
    找到客户 = false;
  }
  断言(找到客户, "数据保存：新建客户能存能查", 测试手机号);

  /* 清理测试数据 */
  await 清理测试客户();
} catch (err) {
  全部通过 = false;
  记录("执行中断", false, err instanceof Error ? err.message : String(err));
  try { await page.screenshot({ path: join(根目录, "smoke-test-failure.png"), fullPage: true }); console.log("已截图: smoke-test-failure.png"); } catch {}
} finally {
  await browser.close();
  await 清理测试客户();
}

/* ── 报告浏览器侧错误 ── */
if (页面错误.length > 0) {
  全部通过 = false;
  console.log("\n❌ 页面 JS 异常:");
  页面错误.forEach((e) => console.log("   " + e));
}
if (控制台错误.length > 0) {
  console.log("\n⚠️ 浏览器 console 错误（仅提示，不计失败）:");
  [...new Set(控制台错误)].slice(0, 5).forEach((e) => console.log("   " + e));
}

console.log(`\n${全部通过 ? "✅ 冒烟测试全部通过" : "❌ 冒烟测试存在失败项"}`);
process.exit(全部通过 ? 0 : 1);
