@echo off
chcp 65001 >nul
schtasks /Create /TN "汽修管家-考核记录每日生成" /SC DAILY /ST 23:00 /TR "C:\projects\auto-repair-shop\每日生成考核记录.bat" /F
