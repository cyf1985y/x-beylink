# public／靜態檔

## countdown-321go.mp3（**尚未放入，必須補**）

計分板「▶ 開始回合」的四拍英文倒數語音。`components/RoundCountdown.tsx` 會抓
`/countdown-321go.mp3`，用 Web Audio 解碼後播放。

**這個檔案目前不在 repo 裡**——開發環境沒有任何語音合成或音訊編碼工具
（espeak／ffmpeg／lame 皆無），無法產生真人英文語音，所以由人工補上。

### 規格

| 項目 | 值 |
|---|---|
| 路徑 | `public/countdown-321go.mp3` |
| 內容 | 連續唸完 `Three, Two, One, GO!`（**沒有 SHOOT**） |
| 全長 | 約 3.2 秒 |
| 四拍時間戳 | `Three` 0ms、`Two` 800ms、`One` 1600ms、`GO!` 2400ms |

時間戳是硬需求：畫面的四拍是用固定 `setTimeout`（0/800/1600/2400ms）排的，
不會去對齊音檔內容。錄音時每拍的**起音點**要落在上表的時間，對不準畫面就會歪。

### 檔案還沒放進來時的行為

`loadCountdown()` 取不到檔案就回傳 null，`RoundCountdown` 會自動退回原本的
Web Audio 合成嗶聲：四拍的節奏、畫面、震動完全一樣，只是沒有人聲。
所以缺這個檔案不會壞掉，只是聽不到英文語音。

### 為什麼是單一檔案、而且不用 `<audio>`

- **單一檔案**：四個獨立音檔各自的載入與解碼時間不同，拍子會歪。
- **不用 `<audio>`**：iPhone 的實體靜音撥桿一撥，`<audio>` 完全沒聲音，
  而現場小孩的手機十之八九是靜音的。走 Web Audio 並在播放前呼叫
  `enableAudioSession()`（設定 `navigator.audioSession.type = "playback"`）才蓋得過去。
- **不用 SpeechSynthesis**：iOS 上觸發時機不可靠。
- **不做 base64 內嵌**。

靜音撥桿這條需要 iPhone 實機驗證，桌機與 Android 測不出來。
