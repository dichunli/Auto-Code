const fs = require('fs');
const { execSync } = require('child_process');

/* 从 stdin 读取 hook 传入的 JSON，提取编辑的文件路径 */
const d = fs.readFileSync(0, 'utf-8');
const j = JSON.parse(d);
const f = j.tool_input?.file_path || j.tool_response?.filePath || '';

/* 1. 自动修复格式（仅对代码文件） */
if (f && /\.(ts|tsx|js|jsx)$/.test(f)) {
  console.log('--- 自动修复格式: ' + f + ' ---');
  try {
    execSync('npx eslint "' + f + '" --fix --max-warnings=999', { stdio: 'inherit' });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {}
}


/* 2. 类型检查 */
console.log('--- 运行类型检查 ---');
try {
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} catch (e) {}

/* 3. 单元测试（不含数据库集成测试） */
console.log('--- 运行单元测试 ---');
try {
  execSync('npm run test:unit', { stdio: 'inherit' });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} catch (e) {}
