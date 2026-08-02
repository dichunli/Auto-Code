# 部署与运维

## 生产环境

- **服务器**：Windows 11 Pro，通过 PM2 管理 Next.js 进程
- **服务名**：`auto-repair-shop`
- **端口**：3000（本地访问 `http://localhost:3000`）
- **HTTPS 端口**：3443（手机扫码用）
- **启动配置**：`ecosystem.config.js`

## 安全部署流程（重要）

**必须先停服，再构建，再启动**。禁止在 PM2 运行期间删除 `.next` 目录，否则会导致静态文件句柄失效，页面样式/脚本 404 或 500。

```bash
pm2 stop auto-repair-shop
npm run build
pm2 start ecosystem.config.js
```

## 本地测试禁止与生产共用 .next（已踩坑）

**禁止在 PM2 运行期间于项目目录直接跑 `next dev`**——dev 服务器和生产 PM2 共用 `.next` 目录，跑一段时间后 Turbopack 会报 FATAL（0xc0000142 / worker 崩溃 500），还可能污染生产静态文件。

正确的本地验证方式（独立测试目录）：

```bash
mkdir C:\projects\devtest && cd C:\projects\devtest
cp -r C:\projects\auto-repair-shop\src . && cp -r C:\projects\auto-repair-shop\public .
cp C:\projects\auto-repair-shop\{package.json,next.config.ts,tsconfig.json,postcss.config.mjs,.env.local,next-env.d.ts} .
mklink /J C:\projects\devtest\node_modules C:\projects\auto-repair-shop\node_modules
npx next dev --webpack -p 3002
```

注意：Turbopack 不认 junction 链接，必须加 `--webpack`。

## 一键部署

- 项目根目录有 `deploy.bat`，双击可自动完成"停服→构建→启动"
- 如果构建出现红色报错，需先修复错误再重新部署
- 部署完成后需强制刷新浏览器（Ctrl+F5）清除缓存
