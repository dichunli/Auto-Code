@echo off
chcp 65001 > nul
echo ========================================
echo  汽修管家 — 一键部署脚本
echo ========================================
echo.

REM 步骤1：停止旧服务
echo [1/5] 正在停止旧服务...
npx pm2 stop auto-repair-shop > nul 2>&1
npx pm2 delete auto-repair-shop > nul 2>&1
echo       已清理旧进程
echo.

REM 步骤2：删除旧构建目录（防止文件残留导致 chunk 不匹配）
echo [2/5] 清理旧构建目录...
rmdir /s /q .next 2>nul
echo       已清理
echo.

REM 步骤3：重新构建
echo [3/5] 正在构建前端（约需1-2分钟）...
npm run build
if errorlevel 1 (
    echo.
    echo [错误] 构建失败，请检查上方红色报错信息
    pause
    exit /b 1
)
echo       构建成功
echo.

REM 步骤4：清理旧的残留进程
echo [4/5] 清理残留进程...
npx pm2 delete auto-repair-shop > nul 2>&1
echo       已清理
echo.

REM 步骤5：启动新服务
echo [5/5] 正在启动服务...
npx pm2 start ecosystem.config.js
echo.

REM 完成
echo ========================================
echo  部署完成！
echo  访问地址：http://localhost:3000
echo ========================================
pause
