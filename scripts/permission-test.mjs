/* ============================================================
 * 权限测试 + 移动端页面（只读，不写数据）
 *
 * 测试账号角色：mechanic + receptionist + warehouse（无 admin）
 *
 * 验证：
 *   D1 移动底部导航：不应出现需要"收支管理"权限的"收支"项
 *   D2 非管理员访问同义词管理页 → 显示"只有管理员可以访问"
 *   D3 非作者非管理员打开知识库文章 → 不出现删除按钮
 *   E  移动端页面（/m 系列）手机视口下正常渲染
 *
 * 用法: npm run test:perm（账号环境变量同冒烟测试）
 * ============================================================ */

import { chromium, devices } from "playwright";
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

async function 取ID(表) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${表}?select=id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const rows = await res.json();
    return rows?.[0]?.id || null;
  } catch { return null; }
}

const 结果 = [];
let 全部通过 = true;
function 断言(条件, 步骤, 详情 = "") {
  const 通过 = !!条件;
  if (!通过) 全部通过 = false;
  结果.push({ 步骤, 通过 });
  console.log(`${通过 ? "✅" : "❌"} ${步骤}${详情 ? " — " + 详情 : ""}`);
}

const browser = await chromium.launch();

/* 手机视口（iPhone 13 尺寸） */
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: devices["iPhone 13"].userAgent,
});
const page = await context.newPage();
page.setDefaultTimeout(20000);

try {
  /* 登录 */
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#login-account", 账号);
  await page.fill("#login-password", 密码);
  await page.getByRole("button", { name: "登录", exact: true }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });

  /* ── D1 移动底部导航 ── */
  await page.goto(`${BASE}/m`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const 底部导航 = (await page.locator("nav").last().textContent()) || "";
  断言(!底部导航.includes("收支"), "D1 底部导航正确隐藏「收支」项（无 payment:manage 权限）", 底部导航.replace(/\s+/g, ""));
  断言(底部导航.includes("接车") && 底部导航.includes("检查"), "D1 底部导航显示有权限的项（接车/检查）");

  /* ── D2 非管理员访问同义词管理页 ── */
  await page.goto(`${BASE}/settings/synonyms`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const 同义词页文本 = await page.textContent("body");
  断言(同义词页文本 && 同义词页文本.includes("只有管理员"), "D2 非管理员访问同义词页被拦截", "显示管理员专属提示");

  /* ── D3 知识库文章无删除按钮 ── */
  const 文章id = await 取ID("knowledge_articles");
  if (文章id) {
    await page.goto(`${BASE}/knowledge/${文章id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const 删除按钮数 = await page.getByRole("button", { name: /删除/ }).count();
    断言(删除按钮数 === 0, "D3 非作者非管理员看不到知识库删除按钮");
  } else {
    console.log("⏭️  D3 无知识库文章，跳过");
  }

  /* ── E 移动端页面渲染 ── */
  const 移动页面 = ["/m", "/m/reception", "/m/inspection", "/m/quote", "/m/picking", "/m/receiving", "/m/other", "/m/assignment"];
  for (const 路径 of 移动页面) {
    const resp = await page.goto(`${BASE}${路径}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const 文本 = (await page.textContent("body")) || "";
    const 正常 = (resp?.status() || 0) < 400 && 文本.trim().length >= 20 && !文本.includes("Internal Server Error");
    断言(正常, `E 移动端 ${路径} 正常渲染`, `HTTP ${resp?.status()}`);
  }

} catch (err) {
  全部通过 = false;
  console.log("❌ 执行中断:", err instanceof Error ? err.message : err);
  try { await page.screenshot({ path: join(根目录, "smoke-test-failure.png"), fullPage: true }); } catch {}
} finally {
  await browser.close();
}

console.log(`\n${全部通过 ? "✅ 权限+移动端测试全部通过" : "❌ 存在失败项"}`);
process.exit(全部通过 ? 0 : 1);
