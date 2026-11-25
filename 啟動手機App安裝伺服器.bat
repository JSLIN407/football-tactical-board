@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   AI 足球空間戰術推演板 - 6吋手機 App 區網安裝伺服器
echo ========================================================
echo.
echo [步驟 1] 請確認您的 6 吋手機與這台電腦連上同一個 Wi-Fi
echo [步驟 2] 在手機瀏覽器（Android 用 Chrome / iPhone 用 Safari）輸入以下網址：
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do (
    echo     http://%%b:5199
  )
)
echo.
echo [步驟 3] 安裝成全螢幕手機 App：
echo   - Android Chrome：點擊畫面右上角「安裝 App」按鈕或選單「安裝應用程式」
echo   - iPhone Safari ：點擊底部「分享」圖示 -^>「加入主畫面」
echo ========================================================
echo.
call npx vite preview --host 0.0.0.0 --port 5199
pause
