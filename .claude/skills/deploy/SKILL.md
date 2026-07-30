---
name: deploy
description: 安全部署生产环境——停服→构建→启动→自动验证（核心页面 curl + 冒烟测试 + 静态文件 404 检查）。用户说"部署"、"发布"、"上线"时使用。
---

# 安全部署技能

把 `deploy.bat` 的"停服→构建→启动"包装成带自动验证的完整流程，堵住"PM2 运行期间构建导致 404/500"这类事故。

## 执行步骤（严格按顺序，禁止跳步）

### 第 1 步：部署前检查
```bash
git status --short
git branch --show-current
```
- 当前分支必须是 `main`，且有未提交改动时**必须停下来问用户**：先提交还是放弃部署
- 如果不在 main，提醒用户"改动还在功能分支，需要先合并 PR"，不要擅自合并

### 第 2 步：停服 → 构建 → 启动
直接运行 `deploy.bat`（它内部已完成 停服→清理 .next→构建→启动）：
```bash
cmd.exe /c deploy.bat
```
- 构建出现红色报错 → **停止部署**，修复后重来，禁止带病上线
- **禁止**在 PM2 运行期间单独执行 `npm run build` 或删除 `.next` 目录

### 第 3 步：自动验证（部署后必做）
依次执行，任何一步失败都要报告：

1. **核心页面 curl 检查**（期望都是 200 或 307 跳转）：
```bash
curl.exe -s -o /dev/null -w "登录页: %{http_code}\n" --max-time 20 http://localhost:3000/login
curl.exe -s -o /dev/null -w "工单列表: %{http_code}\n" --max-time 20 http://localhost:3000/work-orders
```

2. **冒烟测试**（覆盖登录、工单、数据保存）：
```bash
SMOKE_ACCOUNT=19900001111 SMOKE_PASSWORD=test123456 npm run test:smoke
```

3. **静态文件检查**：从首页 HTML 里抽一个 `/_next/static/` 资源 curl 确认不是 404（防 chunk 失效坑）：
```bash
curl.exe -s http://localhost:3000/login | grep -o '/_next/static/[^"]*' | head -1
# 然后 curl 该路径确认返回 200
```

4. **PM2 状态确认**：
```bash
npx pm2 list
```

### 第 4 步：汇报结果
用中文向用户汇报：
- ✅ 或 ❌ 每一步的结果
- 全部通过 → 提醒用户"浏览器 Ctrl+F5 强制刷新验证"
- 有失败 → 给出具体失败原因和回滚建议（`git checkout 上一个稳定提交` 后重新部署）

## 红线

- 构建失败禁止继续启动
- 验证失败必须如实报告，禁止说"部署成功"
- 涉及修改 `ecosystem.config.js`、`next.config.ts` 的部署改动，必须先问用户确认
