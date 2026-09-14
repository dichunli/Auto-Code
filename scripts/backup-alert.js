/* ============================================================
 * 备份失败告警（由 backup.bat 在失败分支调用）
 *
 * 干两件事：
 *   1. 写 system_alerts 表（kind="备份"），管理员在「系统设置→错误日志」页能看到
 *   2. 配了 DINGTALK_WEBHOOK 环境变量时，发钉钉群机器人消息提醒
 *
 * 用法：node scripts/backup-alert.js "失败原因描述"
 * 注意：本脚本自身任何失败都只打印、不影响调用方退出码（告警不能反过来搞挂备份）
 * ============================================================ */
const fs = require("fs");
const path = require("path");

/* 自动加载项目根目录的 .env.local（backup.bat 直接调 node 时环境变量不会带进来） */
(function 加载本地环境变量() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const 行 of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const 匹配 = 行.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!匹配) continue;
    const [, 名, 原始值] = 匹配;
    if (process.env[名]) continue; /* 已注入的不覆盖 */
    process.env[名] = 原始值.replace(/^["']|["']$/g, "");
  }
})();

const 失败原因 = process.argv[2] || "备份失败（未说明原因）";

/* 写 system_alerts 表（与 error-watch.js 同一模式：同类未解决 30 分钟内不重复插） */
async function 写告警表() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("未配置 SUPABASE 密钥，跳过写告警表");
    return;
  }
  try {
    const 半小时前 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const res = await fetch(
      `${url}/rest/v1/system_alerts?kind=eq.${encodeURIComponent("备份")}&resolved_at=is.null&created_at=gte.${encodeURIComponent(半小时前)}&select=id&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const 已有 = await res.json();
    if (Array.isArray(已有) && 已有.length > 0) {
      console.log("30 分钟内已有未处理的备份告警，不重复写表");
      return;
    }

    await fetch(`${url}/rest/v1/system_alerts`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "备份", message: 失败原因 }),
    });
    console.log("已写入 system_alerts 表");
  } catch (err) {
    console.error("告警写库失败（不影响主流程）:", err.message);
  }
}

/* 发钉钉群机器人（与 error-watch.js 同一机制，共用 DINGTALK_WEBHOOK） */
async function 发钉钉() {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) {
    console.log("未配置 DINGTALK_WEBHOOK，跳过钉钉通知（配置后可收群提醒）");
    return;
  }
  try {
    const 时间 = new Date().toLocaleString("zh-CN");
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: {
          content: `🚨 备份失败告警（${时间}）\n${失败原因}\n请尽快检查服务器，数据库可能已经没有有效备份！`,
        },
      }),
    });
    console.log("已发钉钉通知");
  } catch (err) {
    console.error("钉钉通知发送失败（不影响主流程）:", err.message);
  }
}

async function main() {
  await 写告警表();
  await 发钉钉();
}

main();
