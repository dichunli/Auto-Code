@echo off
chcp 65001 > nul
echo ========================================
echo    设置开机自动启动服务器
echo ========================================
echo.

set "SOURCE=%~dp0start-server.bat"
set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\汽修管家启动.bat"

echo 正在复制启动脚本到开机启动文件夹...
copy /Y "%SOURCE%" "%TARGET%" > nul

if %errorlevel% == 0 (
    echo.
    echo [成功] 已添加到开机启动！
    echo 以后电脑开机时会自动启动服务器。
    echo.
    echo 启动文件位置:
    echo %TARGET%
) else (
    echo.
    echo [失败] 复制失败，请手动复制 start-server.bat 到以下文件夹:
    echo %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
)

echo.
pause
