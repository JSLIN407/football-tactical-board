@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在啟動足球戰術推演板 (http://localhost:5199)...
start "" http://localhost:5199
npm run dev
pause
