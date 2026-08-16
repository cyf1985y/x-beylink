# public／靜態檔

## countdown-321go.m4a

計分板「▶ 開始回合」的四拍英文倒數語音（Three, Two, One, GO!，**沒有 SHOOT**）。
`components/RoundCountdown.tsx` 會抓這個檔案，用 Web Audio 解碼後播放。

目前放的是**手機實錄檔**：5.013 秒、48kHz、AAC，47.9 KB。

`decodeAudioData` 吃得下 mp3／m4a／wav／ogg，換檔案時改 `lib/sound.ts` 的
`COUNTDOWN_SRC` 常數即可，不必轉檔。

### ⚠️ 尚未校準——上線前必做一次

`RoundCountdown.tsx` 裡的 `BEAT_OFFSETS` 目前填的是交接單的規格值
`[0, 800, 1600, 2400]`，**不是這個音檔的實際值**。實錄檔是自然人聲，
四個字不會剛好落在 800ms 的整數倍上，開頭通常也有一段靜音。

沒校準的後果：聲音和畫面數字會不同步（功能不會壞，但看起來會怪）。

### 校準方式（約 30 秒）

```
npm run dev
```

開 <http://localhost:3000/countdown-calibrate.html>，它會：

1. 解碼音檔、畫出實際波形
2. 自動偵測四個字的起音點（綠線）
3. 印出可直接貼回程式的兩行常數

自動偵測不準的話，在波形上由左到右點四下手動標，數字會即時更新。
把印出來的兩行貼進 `components/RoundCountdown.tsx`：

```ts
const BEAT_OFFSETS = [0, ..., ..., ...];  // 四拍相對第一個字的位移
const LEAD_SILENCE_MS = ...;              // 開頭靜音，播放時直接跳過
```

**校準必須在真的瀏覽器上做**——AAC 解碼器只有瀏覽器有，開發容器裡沒有
（ffmpeg／lame／sox 都沒裝，Playwright 附的 Chromium 是開源版、不含專利編解碼器）。

`countdown-calibrate.html` 是開發用工具，正式環境用不到，可以視情況刪掉或擋掉。

### 音檔壞掉或不見時的行為

`loadCountdown()` 抓不到或解不開就回傳 null，`RoundCountdown` 自動退回原本的
Web Audio 合成嗶聲：四拍節奏、畫面、震動完全一樣，只是沒有人聲。所以缺檔不會壞。

### 設計取捨

- **單一檔案**：四個獨立音檔各自的載入與解碼時間不同，拍子會歪。
- **不用 `<audio>`**：iPhone 的實體靜音撥桿一撥，`<audio>` 完全沒聲音，
  而現場小孩的手機十之八九是靜音的。走 Web Audio 並在播放前呼叫
  `enableAudioSession()`（設定 `navigator.audioSession.type = "playback"`）才蓋得過去。
- **不用 SpeechSynthesis**：iOS 上觸發時機不可靠。
- **不做 base64 內嵌**。

靜音撥桿這條需要 iPhone 實機驗證，桌機與 Android 測不出來。
