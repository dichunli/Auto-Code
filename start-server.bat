@echo off
chcp 65001 > nul
echo ========================================
echo        汽修管家 - 启动服务器
echo ========================================
cd /d "%~dp0"
echo 当前目录: %cd%
echo 正在启动 Next.js 服务...
echo.
npm run start
