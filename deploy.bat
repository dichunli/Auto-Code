@echo off
chcp 65001 > nul
echo ========================================
echo  汽修管家 — 一键部署脚本
echo ========================================
echo.

REM 步骤1：ESLint 检查（检查不碰 .next，此时旧服务仍在运行；失败中止不影响生产）
echo [1/7] 正在跑 ESLint 检查...
call npm run lint
if errorlevel 1 (
    echo.
    echo [错误] ESLint 检查未通过，已中止部署（旧服务未受影响）。请修复上方报错后重新部署。
    pause
    exit /b 1
)
echo       ESLint 通过
echo.

REM 步骤2：单元测试（同样在停服前跑，失败中止不影响生产）
echo [2/7] 正在跑单元测试...
call npm run test:unit
if errorlevel 1 (
    echo.
    echo [错误] 单元测试未通过，已中止部署（旧服务未受影响）。请修复上方失败用例后重新部署。
    pause
    exit /b 1
)
echo       单元测试通过
echo.

REM 步骤3：停止旧服务（此后进入停机窗口）
echo [3/7] 正在停止旧服务...
npx pm2 stop auto-repair-shop > nul 2>&1
npx pm2 delete auto-repair-shop > nul 2>&1
echo       已清理旧进程
echo.

REM 步骤4：删除旧构建目录（防止文件残留导致 chunk 不匹配）
echo [4/7] 清理旧构建目录...
rmdir /s /q .next 2>nul
echo       已清理
echo.

REM 步骤5：重新构建
echo [5/7] 正在构建前端（约需1-2分钟）...
npm run build
if errorlevel 1 (
    echo.
    echo [错误] 构建失败，请检查上方红色报错信息
    pause
    exit /b 1
)
echo       构建成功
echo.

REM 步骤6：清理旧的残留进程
echo [6/7] 清理残留进程...
npx pm2 delete auto-repair-shop > nul 2>&1
echo       已清理
echo.

REM 步骤7：启动新服务
echo [7/7] 正在启动服务...
npx pm2 start ecosystem.config.js
echo.

REM 完成
echo ========================================
echo  部署完成！
echo  访问地址：http://localhost:3000
echo ========================================
pause
