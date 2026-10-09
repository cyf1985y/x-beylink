# 自動裁判影片實測與 Claude Code 交接

本目錄保存 PR #5 的離線辨識測試、人工比對、失敗證據及可重跑工具。依使用者授權提交到 `claude/artifact-session-rotoyu`，供 Claude Code fetch 後分析討論；尚未收到 Claude 的獨立分析。

**先讀：** [Claude Code 交接摘要](claude_code_brief.txt)、[即時效能評估](realtime_assessment.txt)、[完整報告與四段疊圖影片](reports/recognition_report.html)。GitHub 不會直接執行 HTML；請在本機瀏覽器開啟，或從 repo 根目錄執行 `python -m http.server 8765 --bind 127.0.0.1 --directory docs/autoref`，再開啟 `http://127.0.0.1:8765/reports/recognition_report.html`。

## 結論與適用範圍

- 原始程式版本：`258b4739f341584c11fae6f37cd8452225bdcf0a`；取用來源的 Git blob SHA 見 [來源紀錄](baseline/source_provenance.json)。本次提交只新增文件、測試工具與證據，未修正產品辨識程式。
- [影片來源](https://www.youtube.com/watch?v=oXBdn4yQYog)：720×720、60 fps、26:52.03；原始輸入 SHA-256 為 `c82097e4e7b4ae48601a09c39f8c52f74c553795fac62670f58a1290c8611ad8`。
- 整片重播略過前 2 秒片頭，以 20 fps、480×480 處理 32,201 格；一直停在 ARMED，沒有自動產生判定。
- 四段個別校正、60 fps、手動開局的診斷：三次過早轉停、一次假手部 NO_CALL。比對詳見 [comparisons.json](baseline/comparisons.json)。這四段不是隨機抽樣，也不是完整全片逐局標註，**不能推算整片準確率**。
- 校正背景是影片的逐像素時間中位數估計，陀螺面積從動態影格估計，區域人工標定；沒有使用真機空盤／靜止陀螺校正檔。影片有字幕、剪接、縮放；此結果不能代表固定俯拍原始影片或手機實測。
- 效能補測：i5-9400、Node 24、480×480，30 秒影片共 1,800 格用 23.49 秒完成離線解碼與處理；暖機後辨識＋規則平均 12.06 ms，p95 13.49 ms，p99 15.22 ms，最慢 47.21 ms。不含瀏覽器取格、Worker 往返、UI、錄影及手機熱降頻。

| 片段 | 原版首個判定 | 人工觀察 |
| --- | --- | --- |
| 00:45–01:10 | 00:46.10 判藍心停轉、輸掉 | 當下兩顆仍轉；約 01:07 紫紅色先停 |
| 10:10–10:33 | 10:10.50 因有手而 NO_CALL | 當下無手，影片標題條被當成大型前景 |
| 18:46–19:07 | 18:46.72 高信心轉停 | 追蹤已缺失 7 格；實際兩顆仍繼續對戰 |
| 21:24–21:33 | 21:24.92 高信心轉停 | 當格自轉量測未知；畫面仍持續旋轉及碰撞 |

## 修正紀錄（Claude Code，基準之後）

依本報告分析後的三項修正，均附單元測試（`npm test`，58 項）：

| 修正 | 位置 | 對應的失敗 |
| --- | --- | --- |
| 手部只累計落在區域圖內的像素 | `lib/autoref/vision/pipeline.ts` `insideZonePixels` | 10:10.50 假手部；整片 95% 影格被標題條標成有手而卡在 ARMED |
| 停轉確認只累計有效停止觀測；看不到／黏合／量不到／重複格只記 gap，超過 `spinStopMaxGapFrames`（預設 2）歸零；管線無新量測時回報 null | `lib/autoref/rules.ts` `observeStop`、`lib/autoref/vision/spin.ts` `decideSpinning` | 18:46.72（追蹤缺失 7 格）、21:24.92（確認窗內只有 3 格有效觀測）、45.483／45.533 的重複格 |
| 長延遲比對：單格角度≈0 還要隔 `spin.longLagFrames`（預設 8）格的角度 ≤ `spin.longStopDeg`（預設 4°）才算停止 | `lib/autoref/vision/pipeline.ts` 灰階歷史、`spin.ts` | 00:46.10 的混疊（單格 ±3° 內正負跳動、peak 高） |

`baseline/traces/return_local_60fps` 與 `contact_local_60fps` 的觀測序列已寫成 `lib/autoref/rules.test.ts` 的回歸測試（引擎層；觀測值仍是舊管線輸出）。00:46 的混疊屬影像層，用合成的三重對稱紋理每格轉 119° 做測試（`vision.test.ts`）；真實片段需用下方工具重跑影片驗證，雲端容器抓不到 YouTube，請在本機執行。

Node 22 執行工具需加旗標：`node --experimental-strip-types docs/autoref/tools/run_video.mjs …`。

第二批素材（使用者上傳的 test3 影片，舊版工具疊圖螢幕錄影）的校正、逐局結果與重跑方式見 [clips/test3/README.md](clips/test3/README.md)；通用的單片重播工具是 `tools/run_clip.ts`（原始解析度、自動開局）。

## 目錄

| 位置 | 用途 |
| --- | --- |
| `baseline/recognition_results.json` | 完整原始測試摘要、限制、比對及診斷結果 |
| `baseline/realtime_benchmark.json` | 獨立效能補測，不與原整片平均混算 |
| `baseline/traces/*.jsonl.gz` | 無損壓縮逐格紀錄；完整影片留存每兩格（10 fps）及所有事件，統計仍計入全部 20 fps；片段保留全部 60 fps |
| `baseline/summaries/` | 每個測試的計數、設定、判定及狀態轉移 |
| `baseline/rule_setting_sensitivity.json` | 僅重播規則引擎、改停止確認時間的診斷 |
| `calibration/` | 已使用的 480×480 RGBA 背景（gzip）與 PNG 預覽 |
| `config/` | 主測試與診斷設定；背景路徑相對於設定檔位置 |
| `evidence/` | 原影格／遮罩／分類圖、判定前後截圖、四段辨識疊圖 MP4 |
| `tools/` | 推論、效能、規則敏感度、校正重建與報告渲染工具 |
| `data/`、`runs/` | 本機輸入與重跑輸出，已由本目錄 `.gitignore` 排除 |

`baseline/` 保持不變。以下工具會拒絕覆寫既有結果或受保護的基準目錄。歷史 JSON 內的 `work/...` 路徑與 `reproduction_bundle.zip` 描述是原測試工作區紀錄；本分支以 `config/`、`tools/` 和此 README 的命令為準，不需原工作區或來源副本。

## 重跑目前 repo 的程式

必要環境：Node.js **24**、FFmpeg（含 AV1 解碼能力）在 PATH。Node 推論不用 `npm install`；直接讀取 repo 的 `lib/autoref/` TypeScript。Python 只有下載、重建校正、渲染影片時才需要。

所有命令在 repo 根目錄執行；`--video` 也接受含空白的絕對路徑（請加引號）。完整影片沒有納入 Git。請將原始 MP4 放在 `docs/autoref/data/oXBdn4yQYog.mp4`，或自行指定路徑。

```sh
# 原有規則與影像單元測試
node --test --test-isolation=none lib/autoref/rules.test.ts lib/autoref/vision/vision.test.ts

# 最值得先跑：四段 60 fps 診斷，讀取目前 checkout 的產品程式
node docs/autoref/tools/run_video.mjs --jobs docs/autoref/config/clips.json --video docs/autoref/data/oXBdn4yQYog.mp4 --out docs/autoref/runs/after-fix

# 全片 20 fps；耗時較長，含後段講解
node docs/autoref/tools/run_video.mjs --jobs docs/autoref/config/full.json --video docs/autoref/data/oXBdn4yQYog.mp4 --out docs/autoref/runs/full-after-fix

# 標題遮罩／面積替代值：只用來隔離根因，不能混入主測試成績
node docs/autoref/tools/run_video.mjs --jobs docs/autoref/config/diagnostics.json --video docs/autoref/data/oXBdn4yQYog.mp4 --out docs/autoref/runs/diagnostics-after-fix

# 獨立 30 秒計時，不輸出逐格 JSON；含 p50/p95/p99 與離線吞吐量
node docs/autoref/tools/benchmark_realtime.mjs --video docs/autoref/data/oXBdn4yQYog.mp4 --out docs/autoref/runs/performance-after-fix

# 僅改規則確認時間，以新的影像觀測重播
node docs/autoref/tools/replay_rule_settings.mjs --run docs/autoref/runs/after-fix --out docs/autoref/runs/rule-sensitivity-after-fix.json
```

`--out` 必須是新目錄；省略時自動建立帶時間的 `runs/` 子目錄。推論可加 `--only spin_local_60fps --limit-seconds 4` 做短測；它是截短診斷，不能當成原始完整片段結果。`--ffmpeg` 可指定 FFmpeg 執行檔。

工具預設驗證影片 SHA-256。若平台重編碼或使用不同影片，只有明確加入 `--allow-different-video` 才會繼續，並記錄新 SHA；此時原校正不一定適用，不能視為完全相同的實驗。

### 以原始版本復現

目前 checkout 修正後，可建立另一個 detached checkout（不改動目前分支），再用本分支的工具指定 `--source-root`：

```sh
git worktree add --detach ../x-beylink-autoref-baseline 258b4739f341584c11fae6f37cd8452225bdcf0a
node docs/autoref/tools/run_video.mjs --source-root ../x-beylink-autoref-baseline --jobs docs/autoref/config/clips.json --video docs/autoref/data/oXBdn4yQYog.mp4 --out docs/autoref/runs/original-replay
```

每次重跑會保存來源 Git revision、影片 SHA-256、完整設定、首個及後續判定。計時不應逐位比對；同一來源／解碼條件下，比較 `call`、事件、追蹤與旗標。解碼器版本或像素縮放實作不同，可能造成邊界數值差異。

## 產生新的疊圖與報告

建議使用獨立 Python 環境。安裝下列套件只影響你的工具環境，不是產品依賴：

```sh
python -m pip install -r docs/autoref/tools/requirements.txt
python docs/autoref/tools/render_results.py --run docs/autoref/runs/after-fix --video docs/autoref/data/oXBdn4yQYog.mp4 --out docs/autoref/rendered/after-fix
```

開啟 `docs/autoref/rendered/after-fix/index.html`。疊圖顯示每格 A／B、可見性、自轉、區域、手旗標與程式結果；影片輸出是 20 fps，推論依原設定保持 60 fps。渲染器只展示原有人工觀察，不會自動宣稱新結果正確；需人工核對事件與時間。

若要重新估算背景：

```sh
python docs/autoref/tools/build_backgrounds.py --video docs/autoref/data/oXBdn4yQYog.mp4 --out docs/autoref/calibration-new
```

原估算時間窗見 `config/background_windows.json`。這不等同真機校正，也不會自動改動已提交的面積或多邊形；若改用新背景，請複製設定並明確記錄改變。

選用下載工具（不用登入或 cookies，格式可能隨 YouTube 改變）：

```sh
python docs/autoref/tools/download_video.py
```

## 修正討論與驗收重點

1. 追蹤缺失、合併、量測未知時中斷停轉確認，不以舊的 `false` 狀態持續累計。
2. 區分盤內物件與影片圖文／盤外干擾；10:10.50 的標題條是已確認的假手部來源。
3. 高相關峰值不代表角速度可靠。45.80 秒的 1.292°／peak 0.951 是量測結果；模糊、環狀紋理、陰影與混疊各自的影響仍需分開實驗。
4. 遇到剪接、縮放或大面積變化時暫停裁決並重新校正；以固定俯拍、原始未剪接影片建立下一批獨立資料。
5. 除平均運算時間，也驗證 p95/p99、丟格、相機到裁決延遲及手機長時間發熱。降 fps 會影響每格角度訊號，必須重新驗證判定準確性。

修正後至少確認上述四個早判時刻不再錯誤結算，再核對真正結束時是否給出正確終結、實體陀螺／選手歸屬及時間。需要補充正常成功案例與不同背景、光線、盤型，不能只針對這四段調參。
