# x-beylink（陀螺集結）— 專案指南

台灣戰鬥陀螺（BEYBLADE X）比賽報名平台，宜蘭試點。玩家用 LINE 登入幫小孩報名比賽、累積數位獎盃；店家用後台開賽、掃碼報到、發獎盃。

完整規劃見 Claude 專案文件：《整體架構規劃》v0.8、《Phase1 實作計畫》。

## 技術棧

- Next.js 14（App Router）+ Tailwind CSS，單一專案含玩家端（`/`）、主辦方端（`/host`）、管理端（`/admin`）
- Supabase（Postgres + RLS）：資料庫與認證儲存
- LINE Login（OAuth）唯一登入方式；LINE Messaging API 推播
- Vercel 部署，push main 即自動部署

## 不可違反的業務規則

- 賽事分三級，成團門檻固定：銅級 8 人（每日）、銀級 16 人（每週）、金級 32 人（每月）。門檻寫死在後端，不可由主辦方自填
- 報名截止＝開賽前 2 小時（REGISTRATION_CLOSE_HOURS，寫死不可調）；截止即自動抽籤產生對戰表（lib/autoBracket.ts，頁面載入與 cron 補跑），截止後不可報名／自行取消
- 對戰表用「已報名」名單抽籤；未報到者在對戰表標「未報到」，對手直接點獲勝晉級（爽約視同棄權）。缺席過多時主辦方可用實到名單「重新抽籤」，限尚未記錄任何勝負時
- 主辦方升級規則：未認證主辦方銅級起步，結算完成 3 場後解鎖銀級（lib/organizer.ts effectiveTierAllowed）；金級一律需平台認證；已認證者依平台核定的 tier_allowed，跳過場次限制
- 主辦方積分（organizers.score）：結算完成自動加分——銅 +1、銀 +3、金 +8；平台管理頁可手動調整；賽事頁公開顯示主辦方積分與場次
- 組別為年齡層四組：幼兒／國小組、國中／高中組、成人組、其他；名額上限依等級鎖死（銅 16／銀 32／金 64），後端強制不可調
- 賽事地點收「場地名稱＋地址」（events.address），賽事頁提供 Google Maps 導航連結；等級章視覺階層：金（光暈）＞銀（亮金屬）＞銅（深銅）
- 獎盃只能由該賽事主辦方經 RPC 發放，等級跟隨賽事，玩家不可自改；誤發 48 小時內可撤回
- 選手多為 6–12 歲兒童：暱稱需過敏感詞檢查；不蒐集全名與照片；公開頁只顯示暱稱＋虛擬頭像
- 每個帳號最多 2 位選手：家長、小孩各 1 位（players.role）；選手資料（暱稱/出生年/縣市/戰隊/頭像）建立後不可修改——比賽現場以此認定本人；尚無報名／獎盃紀錄時可刪除重建
- 選手暱稱全平台不可重複（unique index＋建檔時檢查）
- 玩家信譽：無故缺席記 1 點、賽前 72 小時內取消記 0.5 點；2 點停權 30 天、3 點停權 90 天；賽事流局或主辦方取消時玩家信譽一律不受影響
- player_id 永不變更；帳號轉移只改 owner

## 慣例

- UI 文案一律繁體中文（台灣用語）
- 手機優先 RWD，主色調沿用原型：深色賽場風（#0b1026 底、#38e0ff 青、#7c5cff 紫、金銀銅等級色）
- 時間一律存 UTC、顯示 Asia/Taipei
- 金鑰只放環境變數，絕不 commit（.env.local 已在 .gitignore）
- commit 訊息用繁中，格式：`feat: 報名流程` / `fix: 候補遞補順序`

## 常用指令

```
npm run dev        # 本地開發
npm run build      # 建置（CI 會跑）
npm run lint       # ESLint
npx tsc --noEmit   # 型別檢查
npm test           # 自動裁判單元測試（node --test，Node 22 原生 TS，不需額外套件）
```

## 目前狀態

- 原型：index.html（GitHub Pages 展示用，正式開發不共用程式碼，僅作 UI 參考）
- 開發階段：Phase 1（M1–M5）全部實作完成
  - M1 LINE Login（手刻 OAuth，`app/api/auth/`）＋ session（jose JWT cookie）＋ `/me` 選手檔案（敏感詞檢查 `lib/moderation.ts`）
  - M2 賽事列表／詳情、報名／取消／候補遞補（`app/event/actions.ts`）、流局判定（`lib/settle.ts`＋每日 cron＋頁面載入補跑）
  - M3 QR 報到：`/ticket/[regId]` 憑證、`/host/event/[id]` 掃碼（jsQR）＋手動報到
  - M4 `/host/new` 開賽表單（等級受 tier_allowed 限制）、結算發獎盃＋缺席記點、`/player/[id]` 選手卡
  - M5 LINE 推播（`lib/push.ts`，成團/流局/遞補/獎盃/賽前提醒）、`/admin` 平台管理（ADMIN_LINE_USER_IDS）、`/terms`
- 資料庫存取：自訂 LINE 登入（非 Supabase Auth），所有讀寫皆走伺服器端 service role client（`lib/supabase.ts`），擁有權檢查在程式碼層執行；RLS 已開啟擋 anon 直連
- 自動裁判雛形（`/autoref`，規格見 Claude 文件《戰鬥陀螺 X 自動裁判 — 開發規格》）：
  - 手機架在戰鬥盤上方，相機畫面全部在本機運算（Web Worker，純 TypeScript 影像處理，不用 OpenCV.js、不上傳影像）
  - `lib/autoref/rules.ts` 規則引擎：純狀態機（IDLE→ARMED→LIVE→CALLED），不碰 DOM／相機；`rules.test.ts` 以規格 5.1 的 12 局當測試案例
  - `lib/autoref/vision/`：背景相減→形態學→連通元件→區域重疊比例→追蹤（黏合分開用色彩直方圖）→運動補償自轉訊號（極座標互相關）；`vision.test.ts` 用合成影像驗證
  - 頁面：校正（拍背景、紅框自動框對戰區、拖曳極限／出界區、量陀螺面積）、對戰（疊圖、比分、判定卡：確認／改判／重賽不計分、手動爆裂／開始這一局）、回放（每局影片逐格、事件時間軸、匯出）、設定（所有門檻可調、除錯模式）
  - 儲存：IndexedDB（`lib/autoref/storage.ts`），不需後端；PWA：`public/autoref/manifest.webmanifest`＋`public/autoref-sw.js`
  - `lib/autoref` 內部 import 一律帶 `.ts` 副檔名（tsconfig `allowImportingTsExtensions`），讓 Node 測試與 Next 都能解析
  - 尚未實測：運動補償自轉訊號只在合成影像上驗證過，是雛形第一個技術風險；規格 7.2 待作者確認的事項（平手門檻、提前伸手處置、盤型、賽制）預設值見 `lib/autoref/types.ts`
- 下一步：Phase 2（抽籤制、自動組隊、對戰表／計分板、成就徽章、分享海報）；自動裁判假日實地驗收（規格 7.1）
