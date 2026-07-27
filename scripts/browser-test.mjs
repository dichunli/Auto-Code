/* 工单详情页局部更新全面自测（playwright-core + 系统 Edge）
 * 用法：node scripts/browser-test.mjs
 * 流程：登录 → 打开工单 → 添加需求/项目 → 编辑/删除 → 截图验证每步 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const 账号 = process.env.TEST_USER || "19900001111";
const 密码 = process.env.TEST_PASS || "test123456";
const 截图目录 = "scripts/screenshots";
const 工单ID = "ef4c1ff7-0d6c-46d8-b88e-c89772c5b612";
const 测试项目名 = "保养前轮轴承-右";

/* 从 .env.local 读 Supabase 配置（测试前清理数据用） */
const env = fs.readFileSync(".env.local", "utf-8");
const SUPABASE_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim();
const SERVICE_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();

/* 测试前清理：删除工单里的测试项目，避免上次残留导致重复拦截 */
async function 清理测试项目() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const url = `${SUPABASE_URL}/rest/v1/work_order_items?work_order_id=eq.${工单ID}&name=eq.${encodeURIComponent(测试项目名)}`;
  await fetch(url, { method: "DELETE", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
}

/* 测试前清理：删除上次运行残留的"自动化测试需求-xxx"（含关联媒体），
 * 即使上次脚本中途崩溃也不会越积越多 */
async function 清理测试需求() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const 需求 = await (await fetch(
    `${SUPABASE_URL}/rest/v1/work_order_requirements?work_order_id=eq.${工单ID}&description=like.${encodeURIComponent("自动化测试需求")}*&select=id`,
    { headers }
  )).json();
  if (!Array.isArray(需求) || 需求.length === 0) return;
  const ids = 需求.map((r) => r.id).join(",");
  await fetch(`${SUPABASE_URL}/rest/v1/work_order_requirement_media?requirement_id=in.(${ids})`, { method: "DELETE", headers });
  await fetch(`${SUPABASE_URL}/rest/v1/work_order_requirements?id=in.(${ids})`, { method: "DELETE", headers });
  console.log(`  🧹 清理了 ${需求.length} 条上次残留的测试需求`);
}

fs.mkdirSync(截图目录, { recursive: true });

let 步骤计数 = 0;
async function 截图(page, 名称) {
  步骤计数++;
  const 路径 = `${截图目录}/${String(步骤计数).padStart(2, "0")}-${名称}.png`;
  await page.screenshot({ path: 路径, fullPage: false });
  console.log(`  📸 ${路径}`);
}

async function main() {
  await 清理测试需求();
  const browser = await chromium.launch({ channel: "msedge", headless: process.env.HEADED === "1" ? false : true, slowMo: process.env.HEADED === "1" ? 300 : 0 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  // alert/confirm 自动接受，避免阻塞
  page.on("dialog", (d) => d.accept());
  // 抓页面 console 所有输出（含调试日志）和错误
  page.on("console", (msg) => { const t = msg.text(); if (t.includes("[调试]") || msg.type() === "error") console.log("  [浏览器]", t.slice(0, 200)); });
  page.on("pageerror", (err) => console.log("  [页面异常]", String(err).slice(0, 300)));

  // ═══ 1. 登录 ═══
  console.log("═══ 1. 登录 ═══");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder*="手机号"]', 账号);
  await page.fill('input[placeholder*="密码"]', 密码);
  await page.click('button:has-text("登录")');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  console.log("  登录成功，当前页面:", page.url());
  await 截图(page, "登录成功");

  // ═══ 2. 直接打开测试工单（WO-20260617-001，有需求/项目/配件） ═══
  console.log("═══ 2. 打开工单详情 ═══");
  await page.goto(`${BASE_URL}/work-orders/${工单ID}`, { waitUntil: "networkidle" });
  console.log("  工单详情页:", page.url());
  await 截图(page, "工单详情");

  // ═══ 3. 添加需求（局部更新：应瞬间出现） ═══
  console.log("═══ 3. 测试添加需求 ═══");
  const 加需求按钮 = page.locator('button:has-text("+需求")').first();
  if (await 加需求按钮.count()) {
    await 加需求按钮.click();
    await page.waitForSelector('textarea', { timeout: 5000 });
    const 需求描述 = `自动化测试需求-${Date.now()}`;
    await page.fill('textarea', 需求描述);
    await 截图(page, "填写需求");
    await page.click('button:has-text("保存")');
    // 等弹窗关闭（保存完成）
    await page.waitForSelector('textarea', { state: "detached", timeout: 15000 });
    // 局部更新验证：页面上应出现新需求卡片（文本在需求卡片标题里）
    const 新卡片 = page.locator(`button:has-text("${需求描述}")`).first();
    try {
      await 新卡片.waitFor({ timeout: 3000 });
      console.log("  ✅ 新需求瞬间出现（局部更新生效，未整页刷新）");
    } catch {
      console.log("  ❌ 新需求未在 3 秒内出现");
    }
    await 截图(page, "新需求出现");

    // ═══ 4. 添加项目（局部更新：新行应瞬间出现） ═══
    console.log("═══ 4. 测试添加项目 ═══");
    await 清理测试项目();
    await page.reload({ waitUntil: "networkidle" });
    const 加项目按钮 = page.locator('button:has-text("+项目")').first();
    if (await 加项目按钮.count()) {
      await 加项目按钮.click();
      await page.waitForSelector('input[placeholder*="搜索"]', { timeout: 5000 });
      // 点击"保养前轮轴承-右"项目卡片（工单里没有，避免重复拦截）
      const 第一个卡片 = page.locator('.border.rounded-lg.p-3.cursor-pointer:visible:has-text("保养前轮轴承-右")').first();
      await 第一个卡片.click();
      await page.waitForTimeout(300);
      await 截图(page, "勾选项目");
      await page.click('button:has-text("添加 (")');
      // 连续观察弹窗 DOM 是否存在（"批量选择维修项目"标题）
      for (let i = 1; i <= 6; i++) {
        await page.waitForTimeout(1000);
        const 弹窗标题数 = await page.locator('h2:has-text("批量选择维修项目")').count();
        const 新行数 = await page.locator('text=保养前轮轴承-右').count();
        console.log(`  ${i}秒后: 弹窗标题=${弹窗标题数}, "保养前轮轴承-右"出现=${新行数}次`);
        if (弹窗标题数 === 0) break;
      }
      await 截图(page, "点击添加后");

      // ═══ 5. 编辑项目改单价（局部更新：金额和合计应瞬间变） ═══
      console.log("═══ 5. 测试编辑项目单价 ═══");
      const 新行编辑按钮 = page.locator('div:has-text("保养前轮轴承-右")').last().locator('..').locator('button:has-text("编辑")').first();
      if (await 新行编辑按钮.count()) {
        await 新行编辑按钮.click();
        await page.waitForSelector('h2:has-text("编辑维修项目")', { timeout: 5000 });
        const 单价输入 = page.locator('input[type="number"]').last();
        await 单价输入.fill("88");
        await 截图(page, "改单价");
        await page.click('button:has-text("保存")');
        await page.waitForSelector('h2:has-text("编辑维修项目")', { state: "detached", timeout: 8000 });
        await 截图(page, "改价后");
        const 合计文本 = await page.locator('text=应收合计').first().textContent();
        console.log("  改价后应收合计区域:", 合计文本);
      } else {
        console.log("  ⚠️ 没找到新行的编辑按钮");
      }

      // ═══ 6. 业务类型切换（局部更新：标签瞬间变色） ═══
      console.log("═══ 6. 测试业务类型切换 ═══");
      const 类型标签 = page.locator('button:has-text("正常")').first();
      if (await 类型标签.count()) {
        await 类型标签.click();
        await page.waitForTimeout(400);
        // 选下拉弹层（fixed z-30 容器）里的"保险"选项，避免匹配到行内已有标签
        await page.locator('.fixed.z-30 button:has-text("保险")').first().click();
        await page.waitForTimeout(800);
        await 截图(page, "切换保险后");
        console.log("  ✅ 业务类型切换完成（看截图确认标签变色）");
      } else {
        console.log("  ⚠️ 没找到业务类型标签");
      }

      // ═══ 7. 删除项目（局部更新：行瞬间消失） ═══
      console.log("═══ 7. 测试删除项目 ═══");
      const 删除前行数 = await page.locator('text=保养前轮轴承-右').count();
      const 新行删除按钮 = page.locator('div:has-text("保养前轮轴承-右")').last().locator('..').locator('button:has-text("删除")').first();
      if (await 新行删除按钮.count()) {
        await 新行删除按钮.click();
        await page.waitForTimeout(1500);
        const 删除后行数 = await page.locator('text=保养前轮轴承-右').count();
        console.log(`  删除前出现 ${删除前行数} 次 → 删除后出现 ${删除后行数} 次`);
        if (删除后行数 < 删除前行数) {
          console.log("  ✅ 删除后行瞬间消失（局部更新生效）");
        } else {
          console.log("  ❌ 删除后行未消失");
        }
        await 截图(page, "删除后");
      } else {
        console.log("  ⚠️ 没找到新行的删除按钮");
      }

      // ═══ 8. 拖拽排序（配件组拖拽，序号应即时重排） ═══
      console.log("═══ 8. 测试配件组拖拽序号重排 ═══");
      const 拖拽手柄数 = await page.locator('[title="拖动排序"]').count();
      if (拖拽手柄数 >= 3) {
        // 记录拖拽前配件组序号（1.1.1 / 1.1.2）
        const 组序号前 = await page.locator('.bg-blue-50 .font-mono, .bg-blue-50 span').allTextContents();
        console.log("  拖拽前配件组区文本片段:", 组序号前.join(" ").slice(0, 60));
        // 配件组手柄是第 2、3 个（第 1 个是项目级）：组1(nth1) 拖到 组2(nth2)
        await page.locator('[title="拖动排序"]').nth(1).dragTo(page.locator('[title="拖动排序"]').nth(2));
        await page.waitForTimeout(1200);
        const 组序号后 = await page.locator('.bg-blue-50 .font-mono, .bg-blue-50 span').allTextContents();
        console.log("  拖拽后配件组区文本片段:", 组序号后.join(" ").slice(0, 60));
        await 截图(page, "拖拽后");
        if (组序号前.join() !== 组序号后.join()) {
          console.log("  ✅ 拖拽后序号即时重排（局部更新生效）");
        } else {
          console.log("  ⚠️ 文本未变化（看截图确认序号）");
        }
      } else {
        console.log(`  ⚠️ 拖拽手柄不足（${拖拽手柄数}个），无法测配件组拖拽`);
      }
    } else {
      console.log("  ⚠️ 没有找到+项目按钮");
    }
  } else {
    console.log("  ⚠️ 没有找到+需求按钮（可能被锁定）");
  }

  await browser.close();
  console.log("\n═══ 测试完成 ═══");
}

main().catch((err) => {
  console.error("测试失败:", err.message);
  process.exit(1);
});
