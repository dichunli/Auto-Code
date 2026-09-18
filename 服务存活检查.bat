@echo off
rem 服务存活检查（Windows 计划任务每 5 分钟调用）
cd /d C:\projects\auto-repair-shop
node --env-file=.env.local scripts\error-watch.js >> "%USERPROFILE%\.pm2\logs\watchdog-run.log" 2>&1
