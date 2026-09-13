/* ============================================================
 * alert/prompt 替换 codemod（一次性治理工具）
 * 规则：
 *   alert(x)  → toast(x, "error"/"success"/"warning")（按内容归类）
 *   多行/超长（>120 字符）alert → await 全局提示(x)（需 async，否则标人工）
 *   prompt(x) → await 全局输入(x)（需 async，否则标人工）
 * 扫描器字符串/模板/注释感知：字符串里的括号不影响配对计数。
 * 用法：
 *   node scripts/replace-alerts.js            —— 干跑，只统计不改
 *   node scripts/replace-alerts.js --apply    —— 实际改写
 * ============================================================ */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const APPLY = process.argv.includes("--apply");

/* 字符串感知的平衡括号扫描：起点为 "(" 之后，返回到匹配的 ")" 之后的位置 */
function 扫描到配对右括号(文本, 起点) {
  let 深 = 1;
  let j = 起点;
  /* 状态栈：'single' 'double' 'template' 模板里遇 ${ 入代码态（压栈 '}'） */
  const 栈 = [];
  while (j < 文本.length && 深 > 0) {
    const c = 文本[j];
    const 顶 = 栈[栈.length - 1];
    if (顶 === "'" || 顶 === '"') {
      if (c === "\\") { j += 2; continue; }
      if (c === 顶) 栈.pop();
      j++; continue;
    }
    if (顶 === "`") {
      if (c === "\\") { j += 2; continue; }
      if (c === "`") { 栈.pop(); j++; continue; }
      if (c === "$" && 文本[j + 1] === "{") { 栈.push("${"); j += 2; continue; }
      j++; continue;
    }
    /* 代码态 */
    if (c === "'" || c === '"' || c === "`") { 栈.push(c); j++; continue; }
    if (c === "/" && 文本[j + 1] === "/") {
      const e = 文本.indexOf("\n", j);
      j = e < 0 ? 文本.length : e + 1;
      continue;
    }
    if (c === "/" && 文本[j + 1] === "*") {
      const e = 文本.indexOf("*/", j + 2);
      j = e < 0 ? 文本.length : e + 2;
      continue;
    }
    if (顶 === "${" && c === "}") { 栈.pop(); j++; continue; }
    if (c === "(") 深++;
    else if (c === ")") 深--;
    j++;
  }
  return j;
}

/* 判断位置是否在 async 函数内：往前找最近的函数开头 */
function 在异步函数内(文本, 位置) {
  const 前 = 文本.slice(0, 位置);
  const 函数头 = [...前.matchAll(/(async\s+function|async\s*\([^)]*\)|async\s+\w+\s*\([^)]*\)|async\s+\w+\s*=>|function\s*\w*\s*\([^)]*\)|\([^)]*\)\s*=>|\w+\s*=>)/g)];
  if (函数头.length === 0) return false;
  return /^async/.test(函数头[函数头.length - 1][0]);
}

/* 按内容归类 toast 类型 */
function 归类(内容) {
  if (/失败|错误|异常|不能|无法|无效|不足|超出|未找到|不存在|已存在|重复|请检查|拒绝|禁止|未登录|过期|缺/.test(内容)) return "error";
  if (/成功|已保存|已删除|已提交|已完成|已更新|已创建|已添加|已生成/.test(内容)) return "success";
  return "warning";
}

function 处理文件(文件路径) {
  const 文本 = fs.readFileSync(文件路径, "utf8");
  if (!/"use client"/.test(文本.slice(0, 200))) return null;

  const 统计 = { alert: 0, prompt: 0, 需人工: [] };
  let 输出 = "";
  let i = 0;
  let 改动 = false;
  while (i < 文本.length) {
    const mAlert = 文本.slice(i).match(/^(?:[ \t]*)alert\s*\(/);
    const mPromptEq = 文本.slice(i).match(/^(?:[ \t]*(?:const|let|var)\s+\w+\s*=\s*)prompt\s*\(/);
    const mPromptBare = 文本.slice(i).match(/^(?:[ \t]*)prompt\s*\(/);
    const mPrompt = mPromptEq || mPromptBare;
    if (mAlert) {
      const 内容起点 = i + mAlert[0].length;
      const j = 扫描到配对右括号(文本, 内容起点);
      const 内容 = 文本.slice(内容起点, j - 1);
      const 异步 = 在异步函数内(文本, i);
      if (/\\n/.test(内容) || 内容.length > 120) {
        if (异步) {
          输出 += mAlert[0].replace(/alert\s*\($/, "") + `await 全局提示(${内容})`;
          统计.alert++;
          改动 = true;
        } else {
          输出 += 文本.slice(i, j);
          统计.需人工.push("多行/超长 alert 在非 async 函数: " + JSON.stringify(内容.slice(0, 40)));
        }
      } else {
        输出 += mAlert[0].replace(/alert\s*\($/, "") + `toast(${内容}, "${归类(内容)}")`;
        统计.alert++;
        改动 = true;
      }
      i = j;
      continue;
    }
    if (mPrompt) {
      /* 直接定位 prompt( 关键字（mPromptEq 含变量声明前缀） */
      const k = 文本.indexOf("prompt(", i);
      const 内容起点 = k + 7;
      const j = 扫描到配对右括号(文本, 内容起点);
      const 内容 = 文本.slice(内容起点, j - 1);
      const 异步 = 在异步函数内(文本, i);
      if (异步) {
        输出 += 文本.slice(i, k) + `await 全局输入(${内容})`;
        统计.prompt++;
        改动 = true;
      } else {
        输出 += 文本.slice(i, j);
        统计.需人工.push("prompt 在非 async 函数: " + JSON.stringify(内容.slice(0, 40)));
      }
      i = j;
      continue;
    }
    输出 += 文本[i];
    i++;
  }

  if (!改动) return 统计.需人工.length ? 统计 : null;

  /* 插入 import（文件已有同名 import 则合并跳过） */
  const 需要toast = /(?<![\w.])toast\(/.test(输出);
  const 需要提示 = 输出.includes("全局提示(");
  const 需要输入 = 输出.includes("全局输入(");
  const import行们 = [];
  if (需要toast && !输出.includes('from "@/lib/globalToast"')) {
    import行们.push('import { toast } from "@/lib/globalToast";');
  }
  if ((需要提示 || 需要输入) && !输出.includes('from "@/components/GlobalDialogs"')) {
    const 名 = [需要提示 && "全局提示", 需要输入 && "全局输入"].filter(Boolean).join(", ");
    import行们.push(`import { ${名} } from "@/components/GlobalDialogs";`);
  }
  if (import行们.length > 0) {
    /* 找最后一个 from 型 import 的结尾（支持跨行 import），插到它后面；
       没有 from 型 import 就插到 "use client" 声明行之后 */
    const import匹配们 = [...输出.matchAll(/^import[\s\S]*?from\s*["'][^"']+["'];?[^\n]*\n/gm)];
    if (import匹配们.length > 0) {
      const 最后 = import匹配们[import匹配们.length - 1];
      const 插入点 = (最后.index ?? 0) + 最后[0].length;
      输出 = 输出.slice(0, 插入点) + import行们.join("\n") + "\n" + 输出.slice(插入点);
    } else {
      const client行 = 输出.match(/^"use client";\s*\n/m);
      if (client行) {
        const 插入点 = (client行.index ?? 0) + client行[0].length;
        输出 = 输出.slice(0, 插入点) + "\n" + import行们.join("\n") + "\n" + 输出.slice(插入点);
      } else {
        输出 = import行们.join("\n") + "\n" + 输出;
      }
    }
  }

  if (APPLY) fs.writeFileSync(文件路径, 输出, "utf8");
  return 统计;
}

function 遍历(目录, 结果) {
  for (const 项 of fs.readdirSync(目录, { withFileTypes: true })) {
    if (项.name === "node_modules" || 项.name === ".next") continue;
    const 全路径 = path.join(目录, 项.name);
    if (项.isDirectory()) 遍历(全路径, 结果);
    else if (/\.(ts|tsx)$/.test(项.name)) {
      const 文本 = fs.readFileSync(全路径, "utf8");
      if (!/(?<![\w.$])(alert|prompt)\s*\(/.test(文本)) continue;
      const r = 处理文件(全路径);
      if (r) 结果.push({ 文件: path.relative(SRC, 全路径), ...r });
    }
  }
}

const 结果 = [];
遍历(SRC, 结果);
let 总alert = 0, 总prompt = 0;
for (const r of 结果) {
  总alert += r.alert;
  总prompt += r.prompt;
  if (r.需人工.length) console.log(`⚠️ ${r.文件}: ${r.需人工.join("；")}`);
}
console.log(`\n共处理文件 ${结果.length} 个，alert→toast/提示 ${总alert} 处，prompt→输入弹窗 ${总prompt} 处`);
console.log(APPLY ? "✅ 已写入" : "（干跑，未改文件。加 --apply 实际写入）");
