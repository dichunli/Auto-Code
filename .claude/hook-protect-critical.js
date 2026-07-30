/*
 * 高危文件保护 hook（PreToolUse，匹配 Write|Edit）
 *
 * 背景：曾经改认证存储机制（client.ts）导致已登录用户全部加载不出数据。
 * 本 hook 在修改高危文件前自动备份 .bak，并输出"改动前三问"提醒。
 *
 * 注意：PreToolUse hook 无法真正"阻止"操作（除非返回非零退出码阻断），
 * 这里采用"备份 + 醒目提醒"策略，不做硬阻断，避免打断正常开发。
 */

const fs = require('fs');
const path = require('path');

/* 高危文件清单（相对项目根目录，统一用小写正斜杠匹配） */
const 高危文件 = [
  'src/lib/supabase/client.ts',
  'src/lib/supabase/server.ts',
  'src/middleware.ts',
  'src/app/login/page.tsx',
  'next.config.ts',
  'package.json',
  'ecosystem.config.js',
  'capacitor.config.ts',
];

/* 从 stdin 读取 hook 传入的 JSON */
const 输入 = fs.readFileSync(0, 'utf-8');
let 数据;
try {
  数据 = JSON.parse(输入);
} catch {
  process.exit(0); /* 解析失败不阻断 */
}

const 文件路径 = (数据.tool_input?.file_path || '').replace(/\\/g, '/').toLowerCase();

/* 判断是否为高危文件（路径以清单项结尾即可，兼容绝对路径） */
const 命中 = 高危文件.find((f) => 文件路径.endsWith(f));
if (!命中) {
  process.exit(0); /* 非高危文件，直接放行 */
}

/* 1. 自动备份 .bak（只在 .bak 不存在或源文件比 .bak 新时更新） */
try {
  const 源文件 = 数据.tool_input.file_path;
  const 备份文件 = 源文件 + '.bak';
  if (fs.existsSync(源文件)) {
    const 需要备份 =
      !fs.existsSync(备份文件) ||
      fs.statSync(源文件).mtimeMs > fs.statSync(备份文件).mtimeMs;
    if (需要备份) {
      fs.copyFileSync(源文件, 备份文件);
      console.log(`[高危文件保护] 已自动备份: ${path.basename(备份文件)}`);
    }
  }
} catch (err) {
  console.log('[高危文件保护] 备份失败（不阻断操作）: ' + (err instanceof Error ? err.message : String(err)));
}

/* 2. 输出"改动前三问"醒目提醒（会显示给 Claude 和用户） */
console.log('');
console.log('⚠️⚠️⚠️ 高危文件修改警告 ⚠️⚠️⚠️');
console.log(`正在修改: ${命中}`);
console.log('改动前必须回答"三问"：');
console.log('  1. 只动什么？→ 禁止顺手优化别的东西');
console.log('  2. 已有数据/已登录 session 会受影响吗？→ 存量用户不能掉数据');
console.log('  3. 改完测什么？→ 涉及认证必测：已登录用户刷新页面，数据还显示吗？');
console.log('已自动备份 .bak，如需回滚: git checkout -- <文件> 或用 .bak 恢复');
console.log('⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️');
console.log('');

process.exit(0);
