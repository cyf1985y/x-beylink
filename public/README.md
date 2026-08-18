# public／靜態檔

## countdown-321go.mp3

計分板「▶ 開始回合」的四拍英文倒數語音（Three, Two, One, GO!，**沒有 SHOOT**）。
`components/RoundCountdown.tsx` 會抓這個檔案，用 Web Audio 解碼後播放。

實錄檔：3.631 秒、44.1kHz、mp3、57.6 KB、動態範圍 47.9 dB。

`decodeAudioData` 吃得下 mp3／m4a／wav／ogg，換檔案時改 `lib/sound.ts` 的
`COUNTDOWN_SRC` 常數即可，不必轉檔。

### 已量測的內容（ffmpeg 解碼後取 2.5ms RMS 包絡線）

| 段 | 起音 | 結束 | 長度 | 內容 |
|---|---|---|---|---|
| 1 | 578 ms | 868 ms | 290 ms | Three |
| 2 | 1372 ms | 1692 ms | 320 ms | Two |
| 3 | 2175 ms | 2485 ms | 310 ms | One |
| 4 | 2890 ms | 2995 ms | 105 ms | Go |
| — | 3015 ms | 3365 ms | 350 ms | **Shoot（不播）** |

⚠️ **Go 與 Shoot 是連讀的**，中間只有 20ms 低谷（最低點 3002ms，RMS 0.0023），
不是分開的兩個字。用一般門檻的分段器會把它們看成同一段 475ms 的聲音——
第一次量就是這樣量錯的，把 Shoot 的起點當成了 Go。

對應到 `components/RoundCountdown.tsx` 的三個常數：

```ts
const BEAT_OFFSETS = [0, 795, 1598, 2308];  // 四拍相對第一個字
const LEAD_SILENCE_MS = 578;                // 開頭靜音，播放時跳過
const PLAY_MS = 2425;                       // 切在 Go／Shoot 的低谷
```

切點離 Go 結束只有 8ms、離 Shoot 起音只有 12ms，所以 `playCountdown` 在收尾
加了 40ms 淡出，避免硬切爆音、也蓋掉可能滲出的 `sh` 氣音。

**量錄音時務必用低門檻（峰值的 2% 上下）並要求 150ms 以上的靜音才算斷字**，
否則連讀的字會被合併、氣音起頭的字會被截掉開頭。

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
