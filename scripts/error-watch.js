/* ============================================================
 * 生产监控告警（生产机运行，计划任务每 5 分钟一次）
 *
 * 两部分：
 *   A. 存活检查（2026-09-04 新增）：网站是否活着 / PM2 进程是否 online /
 *      磁盘剩余是否够（C: 系统盘 / E: 上传文件盘，低于 5GB 告警），
 *      异常发钉钉 + 写 system_alerts 表（系统设置→错误日志页可见）
 *   B. 错误日志监控（原有）：增量读取 PM2 错误日志，发现新错误时发钉钉机器人通知。
 *      原理：记录上次读到的文件位置（偏移量），每次只读新增部分。
 *
 * 用法：node --env-file=.env.local scripts/error-watch.js
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

/* ═══ A. 存活检查（2026-09-04 新增） ═══
 * 网站是否活着 / PM2 进程是否 online / 磁盘剩余是否够。
 * 异常：写 system_alerts 表（同类未解决 30 分钟内不重复插）+ 发钉钉。
 * system_alerts 表由 migrations_20260904_system_alerts.sql 建立。 */

function 建库客户端() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function 写告警(库, kind, message) {
  if (!库) return;
  try {
    /* 同类未解决且 30 分钟内的不重复插 */
    const res = await fetch(
      `${库.url}/rest/v1/system_alerts?kind=eq.${encodeURIComponent(kind)}&resolved_at=is.null&created_at=gte.${encodeURIComponent(new Date(Date.now() - 30 * 60 * 1000).toISOString())}&select=id&limit=1`,
      { headers: { apikey: 库.key, Authorization: `Bearer ${库.key}` } }
    );
    const 已有 = await res.json();
    if (Array.isArray(已有) && 已有.length > 0) return;

    await fetch(`${库.url}/rest/v1/system_alerts`, {
      method: "POST",
      headers: {
        apikey: 库.key,
        Authorization: `Bearer ${库.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind, message }),
    });
  } catch (err) {
    console.error("告警写库失败:", err.message);
  }
}

async function 存活检查() {
  const 库 = 建库客户端();
  const 问题 = [];

  /* 1. 网站是否活着 */
  try {
    const controller = new AbortController();
    const 超时 = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("http://localhost:3000/login", { signal: controller.signal });
    clearTimeout(超时);
    if (res.status !== 200 && res.status !== 307) {
      问题.push({ kind: "网站", message: `登录页返回 HTTP ${res.status}（应为 200）` });
    }
  } catch (err) {
    问题.push({ kind: "网站", message: `登录页无法访问：${err.message}` });
  }

  /* 2. PM2 进程状态 */
  try {
    const out = require("child_process").execSync("npx pm2 jlist", { encoding: "utf-8", timeout: 15000 });
    const 进程们 = JSON.parse(out);
    const 主进程 = 进程们.find((p) => p.name === "auto-repair-shop");
    if (!主进程) {
      问题.push({ kind: "PM2", message: "PM2 里找不到 auto-repair-shop 进程" });
    } else if (主进程.pm2_env?.status !== "online") {
      问题.push({ kind: "PM2", message: `auto-repair-shop 状态异常：${主进程.pm2_env?.status}` });
    }
  } catch (err) {
    问题.push({ kind: "PM2", message: `PM2 状态查询失败：${err.message}` });
  }

  /* 3. 磁盘剩余空间（低于 5GB 告警） */
  try {
    const out = require("child_process").execSync(
      'powershell -NoProfile -Command "Get-PSDrive C,E -ErrorAction SilentlyContinue | Select-Object Name, @{N=\'FreeGB\';E={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json"',
      { encoding: "utf-8", timeout: 15000 }
    );
    const 盘 = JSON.parse(out);
    const 盘列表 = Array.isArray(盘) ? 盘 : [盘];
    for (const d of 盘列表) {
      if (d && d.FreeGB < 5) {
        问题.push({ kind: "磁盘", message: `${d.Name}: 盘剩余空间不足 ${d.FreeGB}GB（低于 5GB）` });
      }
    }
  } catch (err) {
    问题.push({ kind: "磁盘", message: `磁盘空间查询失败：${err.message}` });
  }

  for (const p of 问题) {
    console.log(`⚠️ [${p.kind}] ${p.message}`);
    await 写告警(库, p.kind, p.message);
    await 发钉钉(`🚨 生产告警（${new Date().toLocaleString("zh-CN")}）\n[${p.kind}] ${p.message}\n请及时检查服务器。`);
  }
}

async function main() {
  await 存活检查();

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
