@echo off
chcp 65001 >nul
title 更新 WSL2 内核
echo ============================================
echo  WSL2 内核更新工具
echo ============================================
echo.

REM 检查是否以管理员身份运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] 请以管理员身份运行此脚本！
    echo.
    echo 操作方法：
    echo   1. 右键点击此文件
echo   2. 选择"以管理员身份运行"
    echo.
    pause
    exit /b 1
)

echo [*] 正在更新 WSL2 内核...
echo.

wsl --update

if %errorlevel% neq 0 (
    echo.
    echo [X] WSL 更新失败，尝试使用离线安装包...
    echo.
    echo 请手动下载并安装：
    echo https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi
    echo.
    start https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi
    pause
    exit /b 1
)

echo.
echo [OK] WSL 更新成功！
echo.
echo ============================================
echo  重要：请立即重启电脑
echo ============================================
echo.
echo 重启后请按以下步骤操作：
echo   1. 启动 Docker Desktop
echo   2. 确认左下角显示绿色"Engine running"
echo   3. 运行 start-supabase-and-migrate-p0.bat
echo.

set /p restart=是否立即重启电脑？(Y/N):
if /i "%restart%"=="Y" (
    echo [*] 正在重启...
    shutdown /r /t 5 /c "WSL 更新完成，即将重启"
) else (
    echo [*] 请稍后手动重启电脑。
    pause
)
