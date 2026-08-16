# public／靜態檔

## countdown-321go.m4a

計分板「▶ 開始回合」的四拍英文倒數語音（Three, Two, One, GO!，**沒有 SHOOT**）。
`components/RoundCountdown.tsx` 會抓這個檔案，用 Web Audio 解碼後播放。

目前放的是**手機實錄檔**：5.013 秒、48kHz、AAC，47.9 KB。

`decodeAudioData` 吃得下 mp3／m4a／wav／ogg，換檔案時改 `lib/sound.ts` 的
`COUNTDOWN_SRC` 常數即可，不必轉檔。

### 已量測的內容（ffmpeg 解碼後取 5ms RMS 包絡線）

| 段 | 起音 | 結束 | 長度 | 對應 |
|---|---|---|---|---|
| 1 | 140 ms | 455 ms | 315 ms | Three |
| 2 | 985 ms | 1345 ms | 360 ms | Two |
| 3 | 1985 ms | 2285 ms | 300 ms | One |
| 4 | 2840 ms | 2985 ms | 145 ms | GO |
| 5 | 3625 ms | 3750 ms | 125 ms | **多出來的第 5 段** |

實際拍距是 845／1000／855 ms，不是規格的 800 均等——自然人聲本來就這樣，
所以程式改成吃 `BEAT_OFFSETS` 而不是寫死一拍 800ms。

**第 5 段**（3625ms）超出交接單「四拍、SHOOT 拿掉」的要求。推測是照舊版
習慣唸成「Three, Two, One, Go, Shoot」。處理方式是**播放時切掉**，不必重錄：
`PLAY_MS = 3060`（相對第一個字），GO 播完、第 5 段播不到。

⚠️ 段 1–5 對應到哪些字**尚未經人耳確認**——開發容器聽不到聲音，
這是從「5 段、間隔約 800ms、最後兩段特別短」推出來的。若實際不同，
改 `RoundCountdown.tsx` 的 `BEAT_OFFSETS`／`LEAD_SILENCE_MS`／`PLAY_MS` 即可。

### 換音檔時的校準方式（約 30 秒）

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

開發容器裡沒有預裝任何 AAC 解碼器，但 `pip install imageio-ffmpeg` 會帶一份
完整的 static ffmpeg（含 AAC），也可以在命令列量：

```bash
pip install imageio-ffmpeg
python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"
# 解成 wav 後自己取 RMS 包絡線抓起音點
```

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
