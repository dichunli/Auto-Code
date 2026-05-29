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

## 一键部署

- 项目根目录有 `deploy.bat`，双击可自动完成"停服→构建→启动"
- 如果构建出现红色报错，需先修复错误再重新部署
- 部署完成后需强制刷新浏览器（Ctrl+F5）清除缓存
