@echo off
rem 每日同步考勤数据（Windows 计划任务 23:30 调用，同步昨天的卡）
curl.exe -s "http://localhost:3000/api/cron/sync-attendance?secret=c402d7d7052d8e73b6d2f1ccea3af7c1f23234fafdb08d0e"
