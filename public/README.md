# public／靜態檔

## countdown-321go.mp3

計分板「▶ 開始回合」的四拍英文倒數語音（Three, Two, One, GO!，**沒有 SHOOT**）。
`components/RoundCountdown.tsx` 會抓這個檔案，用 Web Audio 解碼後播放。

實錄檔：3.840 秒、44.1kHz、mp3、60.9 KB、動態範圍 45.3 dB。

`decodeAudioData` 吃得下 mp3／m4a／wav／ogg，換檔案時改 `lib/sound.ts` 的
`COUNTDOWN_SRC` 常數即可，不必轉檔。

### 已量測的內容（ffmpeg 解碼後取 2.5ms RMS 包絡線）

| 段 | 起音 | 結束 | 長度 | 內容 |
|---|---|---|---|---|
| 1 | 55 ms | 440 ms | 385 ms | Three |
| — | 778 ms | 828 ms | 50 ms | 雜音／呼吸聲，**不是字** |
| 2 | 1108 ms | 1610 ms | 502 ms | Two |
| 3 | 2062 ms | 2710 ms | 648 ms | One |
| 4 | 3222 ms | 3790 ms | 568 ms | Go |

拍距 1053／954／1160 ms，比交接單規格的 800ms 慢——這是實錄的自然節奏，
程式吃 `BEAT_OFFSETS` 就是為了不必遷就規格。倒數總長約 3.8 秒。

對應到 `components/RoundCountdown.tsx` 的四個常數：

```ts
const BEAT_OFFSETS = [0, 1053, 2007, 3167];  // 四拍相對第一個字
const LEAD_SILENCE_MS = 55;                  // 開頭靜音，播放時跳過
const PLAY_MS = 0;                           // 0 = 播到檔尾（沒有多餘的字要切）
const TAIL_MS = 650;                         // 必須 > GO 這個字的長度（568ms）
```

⚠️ **換錄音時四個都要一起檢查**：

- `PLAY_MS`：只有在錄音尾巴有多餘的字（例如唸成「Go Shoot」）時才設非 0。
  乾淨四字的錄音沿用非 0 的舊值，會把 GO 切掉。
- `TAIL_MS`：必須大於「GO」這個字本身的長度，否則畫面會在字還沒唸完就收掉。
  這一版的 GO 長 568ms，所以 400ms 不夠用，改成 650ms。

**量錄音時務必用低門檻（峰值的 2% 上下）並要求 150ms 以上的靜音才算斷字**，
否則連讀的字會被合併、氣音起頭的字會被截掉開頭。前一版錄音的「Go Shoot」
就是連讀的（中間只有 20ms 低谷），用一般門檻會把兩個字看成同一段。

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
