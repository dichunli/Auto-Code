@echo off
chcp 65001 >nul
cd /d %~dp0
set PYTHONUTF8=1
start /min "配件需求采集" "C:\Program Files\Python312\python.exe" poller2.py
