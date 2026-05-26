@echo off
chcp 65001 > nul

:: ========================================
::  汽修管家 — 一键备份脚本（含数据库）
:: ========================================
:: 功能：自动备份项目代码 + 数据库数据
:: 用法：双击运行，或添加到 Windows 计划任务定时执行
:: ========================================

setlocal enabledelayedexpansion

:: --- 配置区域 ---
set "PROJECT_DIR=%~dp0"
set "BACKUP_BASE=E:\backup\auto-repair-shop"
set "KEEP_COUNT=10"
:: ----------------

:: 获取当前日期时间
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (
    set "BDATE=%%c%%a%%b"
)
for /f "tokens=1-2 delims=: " %%a in ('time /t') do (
    set "BTIME=%%a%%b"
)
set "TIMESTAMP=%BDATE%_%BTIME%"
set "ZIP_FILE=%BACKUP_BASE%\汽修系统备份_%TIMESTAMP%.zip"

echo ========================================
echo  汽修管家 — 一键备份脚本（含数据库）
echo ========================================
echo.
echo 项目路径：%PROJECT_DIR%
echo 备份目录：%BACKUP_BASE%
echo.

:: 检查 PowerShell 是否可用
powershell -Command "exit" >nul 2>&1
if errorlevel 1 (
    echo [错误] PowerShell 不可用，无法创建压缩包
    pause
    exit /b 1
)

:: 检查 Node.js 是否可用
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] Node.js 未安装，无法导出数据库
    pause
    exit /b 1
)

:: 创建备份目录
if not exist "%BACKUP_BASE%" (
    echo [1/5] 创建备份目录...
    mkdir "%BACKUP_BASE%"
)

:: 步骤1：导出数据库
echo [1/5] 正在导出数据库...
set "DB_BACKUP_DIR=%TEMP%\db_backup_%RANDOM%"
node "%PROJECT_DIR%scripts\backup-db.js" "%DB_BACKUP_DIR%"
if errorlevel 1 (
    echo       数据库导出失败，继续代码备份...
)

:: 步骤2：复制代码文件到临时目录
echo [2/5] 正在复制代码文件...
set "TEMP_BACKUP=%TEMP%\auto_repair_backup_%RANDOM%"
mkdir "%TEMP_BACKUP%" >nul 2>&1

robocopy "%PROJECT_DIR%" "%TEMP_BACKUP%" /E /XD node_modules .next .git android .claude logs /XF *.log tsconfig.tsbuildinfo tmp_*.html model_for_api.sql 车型信息.xlsx /R:0 /W:0 /NFL /NDL /NJH /NJS >nul 2>&1

:: 步骤3：把数据库备份复制到临时目录
if exist "%DB_BACKUP_DIR%" (
    echo [3/5] 正在合并数据库备份...
    mkdir "%TEMP_BACKUP%\数据库备份" >nul 2>&1
    xcopy "%DB_BACKUP_DIR%\*" "%TEMP_BACKUP%\数据库备份\" /E /I /Q >nul 2>&1
    rmdir /S /Q "%DB_BACKUP_DIR%" >nul 2>&1
) else (
    echo [3/5] 数据库备份不可用，跳过...
)

:: 步骤4：压缩为 zip
echo [4/5] 正在压缩备份...
powershell -Command "$ErrorActionPreference = 'Stop'; Compress-Archive -Path '%TEMP_BACKUP%\*' -DestinationPath '%ZIP_FILE%' -Force"

if errorlevel 1 (
    echo [错误] 压缩失败
    rmdir /S /Q "%TEMP_BACKUP%" >nul 2>&1
    pause
    exit /b 1
)

:: 清理临时目录
rmdir /S /Q "%TEMP_BACKUP%" >nul 2>&1

:: 步骤5：删除旧备份，只保留最近 N 个
echo [5/5] 清理旧备份（保留最近 %KEEP_COUNT% 份）...
powershell -Command "$dir='%BACKUP_BASE%'; $keep=%KEEP_COUNT%; $files=Get-ChildItem -Path $dir -Filter '汽修系统备份_*.zip' | Sort-Object CreationTime -Descending; if($files.Count -gt $keep){$files | Select-Object -Skip $keep | Remove-Item -Force}"

:: 显示结果
for %%F in ("%ZIP_FILE%") do set "FSIZE=%%~zF"
echo.
echo ========================================
echo  备份完成！
echo  文件：%ZIP_FILE%
echo  大小：%FSIZE% 字节
echo ========================================

:: 保留窗口5秒后自动关闭
timeout /t 5 >nul
