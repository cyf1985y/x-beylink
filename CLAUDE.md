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
- 賽事等級由平台核定（organizers.tier_allowed），主辦方不能自選超過自己等級的賽事
- 獎盃只能由該賽事主辦方經 RPC 發放，等級跟隨賽事，玩家不可自改；誤發 48 小時內可撤回
- 選手多為 6–12 歲兒童：暱稱需過敏感詞檢查；不蒐集全名；公開頁只顯示暱稱＋虛擬頭像
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
- 下一步：Phase 2（抽籤制、自動組隊、對戰表／計分板、成就徽章、分享海報）
