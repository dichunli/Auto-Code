/* ============================================================
 * 每周库存自动对账（生产机运行）
 * 核对：配件总账 quantity vs 批次明细 remaining 之和
 * 对不上时：发钉钉机器人通知（配置了 DINGTALK_WEBHOOK 的话）+ 打印明细
 * 用法：node --env-file=.env.local scripts/weekly-stock-check.js
 * 建议 Windows 计划任务：每周一早上 8 点跑一次
 * ============================================================ */
const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const 钉钉机器人 = process.env.DINGTALK_WEBHOOK; /* 群机器人 webhook 地址（可选） */

async function 发钉钉(文本) {
  if (!钉钉机器人) return;
  try {
    await fetch(钉钉机器人, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: 文本 } }),
    });
  } catch (err) {
    console.error("钉钉通知发送失败:", err.message);
  }
}

async function main() {
  const supabase = createClient(url, key);

  const { data: parts, error } = await supabase.from("parts").select("id, part_number, name, quantity");
  if (error) {
    console.error("查询配件失败:", error.message);
    await 发钉钉("⚠️ 库存对账任务执行失败：" + error.message);
    process.exit(1);
  }
  const { data: batches } = await supabase.from("part_batches").select("part_id, remaining");

  const 批次和 = new Map();
  for (const b of batches || []) {
    批次和.set(b.part_id, (批次和.get(b.part_id) || 0) + (b.remaining || 0));
  }

  const 对不上 = [];
  for (const p of parts || []) {
    /* 跳过测试件（编码 TEST- 前缀是测试残留，不算对账异常） */
    if (p.part_number && p.part_number.startsWith("TEST-")) continue;
    const 批次总 = 批次和.get(p.id) || 0;
    if (批次总 !== (p.quantity || 0)) {
      对不上.push({ 编码: p.part_number, 名称: p.name, 总账: p.quantity || 0, 批次和: 批次总 });
    }
  }

  const 时间 = new Date().toLocaleString("zh-CN");
  if (对不上.length === 0) {
    console.log(`[${时间}] ✅ 库存对账通过：${(parts || []).length} 种配件总账与批次全部一致`);
    return;
  }

  console.log(`[${时间}] ⚠️ ${对不上.length} 种配件总账与批次对不上：`);
  for (const d of 对不上) {
    console.log(`  ${d.编码} ${d.名称}: 总账 ${d.总账} vs 批次合计 ${d.批次和}`);
  }

  const 前5条 = 对不上.slice(0, 5).map((d) => `${d.编码} ${d.名称}: 总账${d.总账} 批次${d.批次和}`).join("\n");
  await 发钉钉(
    `⚠️ 库存对账异常（${时间}）\n共 ${对不上.length} 种配件总账与批次不符：\n${前5条}${对不上.length > 5 ? "\n……（完整清单见服务器日志）" : ""}\n请尽快核查库存。`
  );
}

main();
