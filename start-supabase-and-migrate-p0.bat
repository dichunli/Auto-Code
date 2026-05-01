@echo off
chcp 65001 >nul
title 汽修管家 - 启动 Supabase 并执行 P0 安全迁移
echo ============================================
echo  汽修管家 - 启动本地 Supabase 并执行 P0 迁移
echo ============================================
echo.

REM 检查 Docker Desktop 是否运行
echo [1/5] 检查 Docker Desktop 状态...
docker info >nul 2>&1
if errorlevel 1 (
    echo [!] Docker Desktop 未运行，正在尝试启动...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo [*] 等待 Docker Desktop 启动（约 40 秒）...
    timeout /t 40 /nobreak >nul

    REM 再次检查
    docker info >nul 2>&1
    if errorlevel 1 (
        echo [X] Docker Desktop 启动失败，请手动启动后再运行此脚本。
        pause
        exit /b 1
    )
)
echo [OK] Docker Desktop 已运行
echo.

REM 进入项目目录
cd /d "%~dp0"

REM 启动本地 Supabase
echo [2/5] 启动本地 Supabase...
npx supabase start
if errorlevel 1 (
    echo [X] Supabase 启动失败，请检查错误信息。
    pause
    exit /b 1
)
echo [OK] Supabase 已启动
echo.

REM 执行采购订单模块数据库迁移（原有）
echo [3/5] 执行采购订单模块数据库迁移...
node scripts/migrate-purchase.js
if errorlevel 1 (
    echo [X] 采购订单迁移失败，请检查错误信息。
    pause
    exit /b 1
)
echo [OK] 采购订单迁移完成
echo.

REM 执行 P0 安全修复迁移
echo [4/5] 执行 P0 安全修复数据库迁移...
node scripts/migrate-p0.js
if errorlevel 1 (
    echo [X] P0 迁移失败，请检查错误信息。
    pause
    exit /b 1
)
echo [OK] P0 安全修复迁移完成
echo.

echo ============================================
echo  全部完成！
echo  Supabase Studio: http://localhost:54323
echo  Next.js 开发服: npm run dev
echo ============================================
pause
