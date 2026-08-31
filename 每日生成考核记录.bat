@echo off
rem 每日生成行为考核记录（Windows 计划任务 23:00 调用）
curl.exe -s "http://localhost:3000/api/cron/generate-behavior-checks?secret=c402d7d7052d8e73b6d2f1ccea3af7c1f23234fafdb08d0e"
