/* ============================================================
 * 生产错误监控告警（生产机运行，每小时一次）
 * 增量读取 PM2 错误日志，发现新错误时发钉钉机器人通知。
 * 原理：记录上次读到的文件位置（偏移量），每次只读新增部分。
 * 用法：node --env-file=.env.local scripts/error-watch.js
 * 建议 Windows 计划任务：每小时跑一次
 * ============================================================ */
const fs = require("fs");
const path = require("path");
const os = require("os");

const 钉钉机器人 = process.env.DINGTALK_WEBHOOK; /* 群机器人 webhook（可选，不配就只打印） */
const 日志文件 = path.join(os.homedir(), ".pm2/logs/auto-repair-shop-error.log");
const 状态文件 = path.join(os.homedir(), ".pm2/logs/.error-watch-offset");

/* 这些噪音不算错误（历史已知的无害报错关键词） */
const 噪音关键词 = [
  "ENOENT",
  "deprecation",
  "ExperimentalWarning",
  "punycode",
];

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
  if (!fs.existsSync(日志文件)) {
    console.log("错误日志不存在（服务还没产生过错误），一切正常");
    return;
  }

  const 当前大小 = fs.statSync(日志文件).size;
  let 上次偏移 = 0;
  let 首次运行 = false;
  try {
    上次偏移 = parseInt(fs.readFileSync(状态文件, "utf8"), 10) || 0;
  } catch {
    首次运行 = true;
  }

  /* 首次运行：只记录当前位置，从"此刻"开始监控，不把历史错误当新增告警 */
  if (首次运行) {
    fs.writeFileSync(状态文件, String(当前大小), "utf8");
    console.log("首次运行：已记录当前日志位置，从下次起只报告新增错误");
    return;
  }

  /* 日志被清空/轮转后比上次偏移还小，从头读 */
  if (当前大小 < 上次偏移) 上次偏移 = 0;

  if (当前大小 === 上次偏移) {
    console.log("无新增错误，一切正常");
    return;
  }

  /* 只读新增部分 */
  const fd = fs.openSync(日志文件, "r");
  const 缓冲 = Buffer.alloc(当前大小 - 上次偏移);
  fs.readSync(fd, 缓冲, 0, 缓冲.length, 上次偏移);
  fs.closeSync(fd);
  fs.writeFileSync(状态文件, String(当前大小), "utf8");

  const 新增内容 = 缓冲.toString("utf8");
  const 新错误行 = 新增内容
    .split(/\r?\n/)
    .filter((行) => /error|Error|错误|失败|exception/i.test(行))
    .filter((行) => !噪音关键词.some((噪音) => 行.includes(噪音)))
    .filter((行) => 行.trim().length > 10);

  if (新错误行.length === 0) {
    console.log("新增日志均为噪音，无需告警");
    return;
  }

  const 时间 = new Date().toLocaleString("zh-CN");
  console.log(`[${时间}] 发现 ${新错误行.length} 条新错误：`);
  新错误行.slice(0, 10).forEach((行) => console.log("  " + 行.slice(0, 150)));

  const 摘要 = 新错误行.slice(0, 5).map((行) => 行.slice(0, 120)).join("\n");
  await 发钉钉(
    `🚨 生产服务新错误（${时间}）\n共 ${新错误行.length} 条：\n${摘要}${新错误行.length > 5 ? "\n……（详见服务器 PM2 日志）" : ""}\n请及时检查系统。`
  );
}

main();
