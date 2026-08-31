@echo off
curl.exe -s -o NUL "http://192.168.1.75:3000/api/cron/sync-attendance?secret=f734d1e8d554d828b2610cfb862a87d3a0702481ac68a761"
