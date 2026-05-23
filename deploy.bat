@echo off
chcp 65001 > nul
echo ========================================
echo  汽修管家 — 一键部署脚本
echo ========================================
echo.

/* 步骤1：停止旧服务 */
echo [1/4] 正在停止旧服务...
pm2 stop auto-repair-shop > nul 2>&1
pm2 delete auto-repair-shop > nul 2>&1
echo       已清理旧进程
echo.

/* 步骤2：重新构建 */
echo [2/4] 正在构建前端（约需1-2分钟）...
npm run build
if errorlevel 1 (
    echo.
    echo [错误] 构建失败，请检查上方红色报错信息
    pause
    exit /b 1
)
echo       构建成功
echo.

/* 步骤3：清理旧的残留进程 */
echo [3/4] 清理残留进程...
pm2 delete auto-repair-shop > nul 2>&1
echo       已清理
echo.

/* 步骤4：启动新服务 */
echo [4/4] 正在启动服务...
pm2 start ecosystem.config.js
echo.

/* 完成 */
echo ========================================
echo  部署完成！
echo  访问地址：http://localhost:3000
echo ========================================
pause
