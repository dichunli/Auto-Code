@echo off
chcp 65001 > nul
schtasks /create /tn "汽修考勤同步" /tr "\"%~dp0考勤同步.bat\"" /sc daily /st 01:00 /f
echo.
echo 安装完成！这台电脑每天凌晨 1:00 会自动同步前一天的考勤。
echo 注意：这台电脑凌晨 1 点要开机，并且和服务器连同一个网络。
echo.
pause
