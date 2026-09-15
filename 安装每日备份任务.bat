@echo off
chcp 65001 > nul
schtasks /create /tn "汽修每日备份" /tr "\"%~dp0backup.bat\"" /sc daily /st 02:30 /f
echo.
echo 安装完成！这台电脑每天凌晨 2:30 会自动备份代码和数据库。
echo 注意：这台电脑凌晨 2:30 要开机；备份失败会自动发钉钉提醒（需先在 .env.local 配置 DINGTALK_WEBHOOK）。
echo.
pause
