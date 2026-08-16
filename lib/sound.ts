"use client";

/** 裁判計分的音效與震動（WebAudio，不需要音檔） */

let AC: AudioContext | null = null;

function ctx(): AudioContext | null {
  try {
    AC =
      AC ??
      new (window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    return AC;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  t0: number,
  dur: number,
  type: OscillatorType = "square",
  gain = 0.08
) {
  const ac = ctx();
  if (!ac) return;
  try {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ac.destination);
    const t = ac.currentTime + t0;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur);
  } catch {
    /* ignore */
  }
}

/**
 * 解鎖音訊：iOS／Chrome 只在使用者手勢中允許出聲，
 * 倒數的第一拍不是點擊當下才播，所以按鈕按下時要先把 AudioContext 喚醒。
 */
export function unlockAudio() {
  const ac = ctx();
  if (ac && ac.state === "suspended") ac.resume().catch(() => {});
}

/**
 * 宣告音訊用途，讓聲音蓋過 iPhone 的實體靜音撥桿。
 *
 * 小孩的手機十之八九是靜音的，而靜音撥桿一撥，<audio> 會完全沒聲音——
 * 倒數走 Web Audio 就是為了這件事。navigator.audioSession 目前只有 Safari 有，
 * 其他瀏覽器讀不到這個屬性，直接跳過即可。
 */
export function enableAudioSession() {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    /* ignore */
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

/** 得分嗶聲：藍方（1P）高音、紅方（2P）低音，分數越高音越亮 */
export function beepScore(side: 1 | 2, points: number) {
  const base = side === 1 ? 660 : 520;
  tone(base + (points - 1) * 90, 0, 0.12);
  if (points >= 3) tone(base + 260, 0.1, 0.14, "triangle", 0.1);
  vibrate(40);
}

/** 扣分／復原：兩短低音 */
export function beepUndo() {
  tone(240, 0, 0.09);
  tone(200, 0.11, 0.09);
  vibrate([50, 40, 50]);
}

/** 勝利號角 */
export function fanfare() {
  [523, 659, 784, 1047].forEach((f, i) =>
    tone(f, i * 0.14, 0.22, "triangle", 0.12)
  );
  vibrate([120, 60, 120, 60, 220]);
}

/** 倒數的一拍（Three、Two、One）：短促的中音嗶 */
export function beepCount() {
  tone(880, 0, 0.16, "square", 0.1);
  vibrate(60);
}

/** GO！：上揚三連音 */
export function beepGo() {
  [988, 1319, 1568].forEach((f, i) =>
    tone(f, i * 0.07, 0.3, "triangle", 0.12)
  );
  vibrate([90, 40, 160]);
}

/* ------------------------------- 倒數英文語音 ------------------------------- */

/**
 * 四拍倒數語音檔：一個檔案連續唸完「Three, Two, One, GO!」。
 *
 * 刻意用「單一檔案」而不是四個檔案：四個檔各自載入解碼的時間不同，拍子會歪。
 * 也刻意不走 <audio>——iPhone 的實體靜音撥桿會讓 <audio> 完全沒聲音，
 * 必須走 Web Audio 並搭配 enableAudioSession()。
 *
 * 目前放的是手機實錄的 m4a（AAC）；decodeAudioData 吃得下 mp3／m4a／wav／ogg，
 * 換檔案時改這個常數即可。四拍在檔案裡的實際位置見 RoundCountdown 的 BEAT_OFFSETS。
 */
export const COUNTDOWN_SRC = "/countdown-321go.m4a";

let countdownBuffer: AudioBuffer | null = null;
let countdownLoading: Promise<AudioBuffer | null> | null = null;

/**
 * 預先載入並解碼倒數語音（畫面掛載時就先跑，按下按鈕才不用等）。
 * 音檔不存在或解碼失敗都只是回傳 null，呼叫端會退回合成嗶聲。
 */
export function loadCountdown(): Promise<AudioBuffer | null> {
  if (countdownBuffer) return Promise.resolve(countdownBuffer);
  if (countdownLoading) return countdownLoading;

  const ac = ctx();
  if (!ac) return Promise.resolve(null);

  countdownLoading = fetch(COUNTDOWN_SRC)
    .then((r) => {
      if (!r.ok) throw new Error(`countdown ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => ac.decodeAudioData(buf))
    .then((decoded) => {
      countdownBuffer = decoded;
      return decoded;
    })
    .catch(() => null);

  return countdownLoading;
}

/**
 * 播放倒數語音。
 *
 * offsetSeconds：從音檔的第幾秒開始播——錄音開頭那段靜音用這個跳過，
 * 這樣畫面的第一拍和聽到「Three」的瞬間才會對齊。
 * durationSeconds：只播這麼長。錄音尾巴多唸的字用這個切掉，不必重錄。
 *
 * 回傳停止函式（倒數中途取消要把聲音一起停掉）；
 * 回傳 null 代表音檔還沒備妥，呼叫端請改用合成嗶聲頂著。
 */
export function playCountdown(
  offsetSeconds = 0,
  durationSeconds?: number
): (() => void) | null {
  const ac = ctx();
  if (!ac || !countdownBuffer) return null;
  try {
    const src = ac.createBufferSource();
    src.buffer = countdownBuffer;
    src.connect(ac.destination);
    if (durationSeconds && durationSeconds > 0) {
      src.start(0, Math.max(0, offsetSeconds), durationSeconds);
    } else {
      src.start(0, Math.max(0, offsetSeconds));
    }
    return () => {
      try {
        src.stop();
      } catch {
        /* 已經播完了 */
      }
    };
  } catch {
    return null;
  }
}

/** 重射：中性的兩聲下行提示（不是得分也不是失誤） */
export function beepReshoot() {
  tone(520, 0, 0.1, "triangle", 0.09);
  tone(390, 0.12, 0.16, "triangle", 0.09);
  vibrate([60, 60, 60]);
}

/**
 * 下一場來了：兩聲上揚的招呼音。
 * 現場很吵、手機常架在戰鬥盤旁邊沒人盯著，純視覺會漏掉。
 */
export function beepNextMatch() {
  tone(784, 0, 0.16, "triangle", 0.11);
  tone(1047, 0.18, 0.26, "triangle", 0.11);
  vibrate([100, 70, 100, 70, 180]);
}

/** 中文語音播報（可關閉） */
export function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-TW";
    u.rate = 0.95;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}
