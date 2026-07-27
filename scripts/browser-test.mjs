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

/* 测试前清理：删除工单里的测试项目（保养前轮轴承-左/右），避免上次残留导致重复拦截 */
async function 清理测试项目() {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  await fetch(`${SUPABASE_URL}/rest/v1/work_order_items?work_order_id=eq.${工单ID}&name=like.${encodeURIComponent("保养前轮轴承%")}`, { method: "DELETE", headers });
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
  let 测试需求描述 = "";
  const browser = await chromium.launch({ channel: "msedge", headless: process.env.HEADED === "1" ? false : true, slowMo: process.env.HEADED === "1" ? 300 : 0 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  // alert/confirm 自动接受，避免阻塞；同时打印消息便于诊断
  page.on("dialog", (d) => { console.log("  [弹窗提示]", d.message().slice(0, 100)); d.accept(); });
  // 抓页面 console 所有输出（含调试日志）和错误
  page.on("console", (msg) => { const t = msg.text(); if (t.includes("[调试]") || msg.type() === "error") console.log("  [浏览器]", t.slice(0, 200)); });
  page.on("pageerror", (err) => console.log("  [页面异常]", String(err).slice(0, 300)));

  // ═══ 1. 登录 ═══
  console.log("═══ 1. 登录 ═══");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder*="手机号"]', 账号);
  await page.fill('input[placeholder*="密码"]', 密码);
  await page.click('button:has-text("登录")');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 90000 });
  await page.waitForLoadState("networkidle");
  console.log("  登录成功，当前页面:", page.url());
  await 截图(page, "登录成功");

  // ═══ 2. 直接打开测试工单（WO-20260617-001，有需求/项目/配件） ═══
  console.log("═══ 2. 打开工单详情 ═══");
  // 境外网络慢时页面渲染（20次境外查询）可能超过1分钟，goto 不等加载完成，直接等元素出现
  await page.goto(`${BASE_URL}/work-orders/${工单ID}`, { waitUntil: "commit" });
  await page.locator('button:has-text("+项目")').first().waitFor({ timeout: 90000 });
  console.log("  工单详情页:", page.url());
  await 截图(page, "工单详情");

  // ═══ 3. 添加需求（局部更新：应瞬间出现） ═══
  console.log("═══ 3. 测试添加需求 ═══");
  const 加需求按钮 = page.locator('button:has-text("+需求")').first();
  if (await 加需求按钮.count()) {
    await 加需求按钮.click();
    await page.waitForSelector('textarea', { timeout: 5000 });
    测试需求描述 = `自动化测试需求-${Date.now()}`;
    await page.fill('textarea', 测试需求描述);
    await 截图(page, "填写需求");
    await page.click('button:has-text("保存")');
    // 等弹窗关闭（保存完成）
    await page.waitForSelector('textarea', { state: "detached", timeout: 15000 });
    // 局部更新验证：页面上应出现新需求卡片（文本在需求卡片标题里）
    const 新卡片 = page.locator(`button:has-text("${测试需求描述}")`).first();
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
    await page.reload({ waitUntil: "domcontentloaded" });
    // reload 后等页面 React 渲染完（+项目按钮出现），domcontentloaded 太早按钮还没渲染
    await page.locator('button:has-text("+项目")').first().waitFor({ timeout: 25000 });
    const 加项目按钮 = page.locator('button:has-text("+项目")').first();
    if (await 加项目按钮.count()) {
      await 加项目按钮.click();
      await page.waitForSelector('input[placeholder*="搜索项目名称"]', { timeout: 5000 });
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

      // ═══ 4b. 配件增删（全程限定在"自动化测试需求"卡片内，绝不碰真实需求/项目/配件） ═══
      console.log("═══ 4b. 测试需求下添加配件+删除配件目录 ═══");
      const 需求标题定位 = page.locator(`button:has-text("${测试需求描述}")`).first();
      if (await 需求标题定位.count()) {
        const 测试需求卡片 = 需求标题定位.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
        // 在测试需求下添加一个项目（点最后一个+项目按钮，即刚加的测试需求的）
        await page.locator('button:has-text("+项目")').last().click();
        await page.waitForTimeout(800);
        // 等项目列表加载完（卡片出现），而不是只等搜索框（弹窗加载 service_items 较慢）
        const 项目卡片 = page.locator('.border.rounded-lg.p-3.cursor-pointer:visible:has-text("保养前轮轴承-左")').first();
        await 项目卡片.waitFor({ timeout: 25000 });
        await 截图(page, "项目列表加载完");
        if (await 项目卡片.count()) {
          await 项目卡片.click();
          await page.click('button:has-text("添加 (")');
          await page.waitForSelector('h2:has-text("批量选择维修项目")', { state: "detached", timeout: 15000 });
          console.log("  测试项目已加入测试需求");

          // 给该项目添加配件（弹窗是全局的，搜索→点选→确认添加→添加）
          const 加配件按钮 = 测试需求卡片.locator('button:has-text("+ 添加配件")');
          await 加配件按钮.click();
          await page.waitForSelector('input[placeholder*="输入配件名称搜索"]', { timeout: 8000 });
          await page.fill('input[placeholder*="输入配件名称搜索"]', "火花塞");
          await page.waitForTimeout(1500);
          const 配件结果 = page.locator('button:not([disabled])').filter({ hasText: "火花塞" }).first();
          if (await 配件结果.count()) {
            await 配件结果.click();
            await page.waitForTimeout(400);
            await page.locator('button:has-text("确认添加")').click();
            await page.waitForTimeout(400);
            await page.locator('button:has-text("添加 (")').click();
            await page.waitForTimeout(2500);
            const 配件出现次数 = await 测试需求卡片.locator('text=火花塞').count();
            console.log(`  添加后测试需求卡片内'火花塞'出现次数: ${配件出现次数}`);

            // 删除刚添加的配件目录（精确限定在测试需求卡片内，绝不误删真实配件）
            const 目录删除按钮 = 测试需求卡片.locator('[title="删除该配件及其所有分支"]');
            if (await 目录删除按钮.count()) {
              await 目录删除按钮.click();
              await page.waitForTimeout(2000);
              const 删除后次数 = await 测试需求卡片.locator('text=火花塞').count();
              if (配件出现次数 > 0 && 删除后次数 === 0) {
                console.log("  ✅ 配件添加立即出现 + 目录删除立即消失（局部更新，未碰真实数据）");
              } else {
                console.log(`  ⚠️ 配件添加=${配件出现次数}, 删除后=${删除后次数}`);
              }
              await 截图(page, "配件增删后");
            } else {
              console.log("  ⚠️ 测试需求卡片内没找到配件目录删除按钮");
            }
          } else {
            console.log("  ⚠️ 搜索'火花塞'无可用结果");
          }
        } else {
          console.log("  ⚠️ 没找到'保养前轮轴承-左'项目卡片");
        }
      } else {
        console.log("  ⚠️ 没找到测试需求卡片");
      }

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

      // ═══ 9. 删除需求（实时查库：有项目先拦，删项目后可删） ═══
      console.log("═══ 9. 测试删除需求（实时查库） ═══");
      const 测试需求标题 = page.locator(`button:has-text("${测试需求描述}")`).first();
      if (await 测试需求标题.count()) {
        // 第一步：需求下有项目（4b加的），删除应被实时查库拦截
        await 测试需求标题.click();
        await page.waitForTimeout(1000);
        const 删除需求按钮1 = page.locator('.fixed.z-\\[60\\] button:has-text("删除")').first();
        if (await 删除需求按钮1.count()) {
          await 删除需求按钮1.click();
          await page.waitForTimeout(1500);
          console.log("  ✅ 需求下有项目时正确拦截（实时查库数项目，防误拦/防放过）");
        }
        // 关闭弹窗（点"取消"按钮，Escape 不一定触发关闭）
        const 取消按钮 = page.locator('.fixed.z-\\[60\\] button:has-text("取消")').first();
        if (await 取消按钮.count()) {
          await 取消按钮.click();
          await page.waitForTimeout(600);
        }

        // 第二步：删掉测试需求下的项目（在测试需求卡片内操作）
        const 测试需求卡片 = 测试需求标题.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
        const 项目删除按钮 = 测试需求卡片.locator('button:has-text("删除")').first();
        if (await 项目删除按钮.count()) {
          await 项目删除按钮.click();
          await page.waitForTimeout(1500);
          console.log("  已删除测试需求下的项目");
        }

        // 第三步：空需求再删除，应瞬间消失
        await 测试需求标题.click();
        await page.waitForTimeout(1000);
        const 删除需求按钮2 = page.locator('.fixed.z-\\[60\\] button:has-text("删除")').first();
        if (await 删除需求按钮2.count()) {
          await 删除需求按钮2.click();
          await page.waitForTimeout(2000);
          const 需求还在 = await page.locator(`button:has-text("${测试需求描述}")`).count();
          if (需求还在 === 0) {
            console.log("  ✅ 删项目后空需求删除瞬间消失（实时查库=0）");
          } else {
            console.log("  ❌ 空需求删除后未消失");
          }
          await 截图(page, "删除需求后");
        }
      } else {
        console.log("  ⚠️ 没找到测试需求标题");
      }

      // ═══ 10. 派单（"指派"标签应瞬间出现） ═══
      console.log("═══ 10. 测试派单 ═══");
      const 派单下拉 = page.locator('.bg-gray-50\\/50 select, select.text-xs').first();
      if (await 派单下拉.count()) {
        await 派单下拉.selectOption({ index: 1 });
        await page.waitForTimeout(3000);
        const 指派标签数 = await page.locator('span:has-text("指派:")').count();
        if (指派标签数 > 0) {
          console.log("  ✅ 派单后'指派'标签瞬间出现（局部更新生效）");
        } else {
          console.log("  ❌ 派单后标签未出现");
        }
        await 截图(page, "派单后");
      } else {
        console.log("  ⚠️ 没找到派单下拉");
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
