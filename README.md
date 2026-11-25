# AI 足球空間戰術推演板 & 全螢幕手機純享版

獨立極簡版足球戰術推演板（支援 **8人制 65m×45m** 與 **11人制 105m×68m**），完全獨立於既有專案之外，同時提供兩個版本：

- **全螢幕手機純享版（`pure.html` / `戰術板純享` APK）**：100% 滿版球場，移除所有 AI 面板、文字框與熱區干擾，僅保留球場與紅藍雙隊棋子／足球拖曳；右上角附微小 `⋯` 按鈕，點擊才展開 `8人/11人`、陣型、直橫切換與重置，觸碰球場即自動收起。
- **AI 空間戰術推演版（`index.html` / `AI戰術板` APK）**：內建一鍵切換「純享全螢幕」，並結合國際足球 AI 空間與軌跡學習文獻驅動跑位演算與即時熱區視覺化：
  1. **Fernández & Bornn (MIT Sloan, 2018) *Wide Open Spaces***：計算雙隊連續 **空間控制權（Pitch Control）**，並區分無球 **牽制拉開空間（SGG）** 與 **切入佔領空間（SOG）**。
  2. **Spearman (MIT Sloan, 2018) *Beyond Expected Goals***：以球員抵達時間（Time-to-Intercept）與球速物理模型即時渲染 **無球跑位得分機會熱區（OBSO）** 與黃金靶心空檔。
  3. **Le, Carr, Yue & Lucey (MIT Sloan / ICML, 2017) *Data-Driven Ghosting***：多代理人協同防守移位（近球壓迫角度、危險跑位跟防、防線橫移與弱側內收）。
  4. **Wang, Veličković et al. / Google DeepMind (*Nature Communications*, 2024) *TacticAI***：傳球路徑遮蔽（Pass Shadow）與最佳接應者決策。
  5. **Ross, Gordon & Bagnell (AISTATS, 2011) *DAgger***：內建「示範訓練」功能，支援以問句搭配手拉棋盤狀態持續訓練專屬戰術庫。

---

## 雲端網址與手機安裝包下載

- **手機純享版線上即開／加入主畫面（PWA）**：https://jslin407.github.io/football-tactical-board/pure.html
- **AI 空間推演版線上即開／加入主畫面（PWA）**：https://jslin407.github.io/football-tactical-board/
- **Android 原生 `.apk` 與單檔離線版雲端下載（GitHub Releases）**：https://github.com/JSLIN407/football-tactical-board/releases/latest
  - `Football-Tactical-Board-Pure-v1.2.0.apk`（全螢幕沉浸式純享版，自動隱藏手機狀態列與導覽列，獨立套件 `app.tacticalboard.football.pure`，可與 AI 版並存安裝）
  - `AI-Football-Tactical-Board-v1.2.0.apk`（完整 AI 推演版，套件 `app.tacticalboard.football`）

---

## 本機檔案與打包指令

- `release/足球戰術板_手機純享版.html`：單檔隨身離線純享版（LINE / AirDrop 傳到手機直接全螢幕開啟）
- `release/AI足球戰術板_手機隨身版.html`：單檔隨身離線 AI 推演版
- 重新建置雙版本與同步 `docs/`：
  ```bash
  npm run build:mobile
  ```
