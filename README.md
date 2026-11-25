# AI 足球空間戰術推演板（支援 6 吋手機直立單手操作 & App 封裝）

獨立極簡版足球戰術推演板（支援 **8人制 65m×45m** 與 **11人制 105m×68m**），完全獨立於既有專案之外，結合國際足球 AI 空間與軌跡學習文獻驅動跑位演算與即時熱區視覺化：

1. **Fernández & Bornn (MIT Sloan, 2018) *Wide Open Spaces***：計算雙隊連續 **空間控制權（Pitch Control）**，並區分無球 **牽制拉開空間（SGG）** 與 **切入佔領空間（SOG）**。
2. **Spearman (MIT Sloan, 2018) *Beyond Expected Goals***：以球員抵達時間（Time-to-Intercept）與球速物理模型即時渲染 **無球跑位得分機會熱區（OBSO）** 與黃金靶心空檔。
3. **Le, Carr, Yue & Lucey (MIT Sloan / ICML, 2017) *Data-Driven Ghosting***：多代理人協同防守移位（近球壓迫角度、危險跑位跟防、防線橫移與弱側內收）。
4. **Wang, Veličković et al. / Google DeepMind (*Nature Communications*, 2024) *TacticAI***：傳球路徑遮蔽（Pass Shadow）與最佳接應者決策。
5. **Ross, Gordon & Bagnell (AISTATS, 2011) *DAgger***：內建「示範訓練」功能，支援以問句搭配手拉棋盤狀態持續訓練專屬戰術庫。

---

## 6 吋手機人體工學優化重點
- **自動直立球場（下往上進攻）**：手機直拿時自動轉為「我方由下往上進攻、左翼維持在左側」的直向球場，顯示面積提升 **2.25 倍**，亦可一鍵切換 `直向場 / 橫向場`。
- **防粗手指誤觸與觸覺回饋**：棋子隱形觸控熱區放大至 `44px`，拖曳時具備 `1.18x` 放大光暈與輕微震動回饋（Android 支援 `navigator.vibrate`），並鎖定畫面回彈避免干擾拉棋。
- **底部單手大拇指操作區**：輸入框強制 `16px` 字級防止 iOS/Android 自動放大畫面，上方情境範例與工具列改為單指橫滑膠囊列，並適配瀏海／動態島與底部 Home 橫條安全區（`100dvh` + `safe-area-inset`）。

---

## 三種手機 App 安裝與打包方式

### 方式 A：區網一鍵安裝全螢幕離線 App（PWA，最推薦、免傳輸線）
1. 電腦雙擊執行 `啟動手機App安裝伺服器.bat`（或將 `dist/` 部署至任意 HTTPS 靜態空間）。
2. 手機連上同一個 Wi-Fi，打開顯示的 `http://192.168.x.x:5199`：
   - **Android (Chrome)**：點擊頂部「安裝 App」或瀏覽器選單「安裝應用程式」。
   - **iPhone (Safari)**：點擊底部「分享」→「加入主畫面」。
3. 安裝後即具備專屬桌面圖示、全螢幕無網址列介面與 Service Worker 離線快取。

### 方式 B：單檔隨身離線版（LINE / AirDrop 直接傳到手機即開即用）
- 檔案路徑：`release/AI足球戰術板_手機隨身版.html`
- 已將所有程式碼、樣式與圖示封裝為單一檔案（約 305 KB），直接傳到手機以瀏覽器開啟即可離線推演。

### 方式 C：原生 Android (`.apk` / `.aab`) 與 iOS (`.ipa`) 專案打包（Capacitor）
- 已預先建置 `android/` 與 `ios/` 原生 Capacitor 專案目錄（App ID：`app.tacticalboard.football`，名稱：`AI戰術板`）。
- 若日後電腦安裝 **Android Studio**（Windows）或 **Xcode**（macOS）：
  ```bash
  npm run cap:sync
  npx cap open android   # 於 Android Studio 點擊 Build > Build APK(s) 即可匯出 .apk
  npx cap open ios       # 於 Xcode 簽署匯出 iPhone App
  ```
