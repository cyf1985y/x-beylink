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

/** 倒數的一拍（3、2、1）：短促的中音嗶 */
export function beepCount() {
  tone(880, 0, 0.16, "square", 0.1);
  vibrate(60);
}

/** GO SHOOT！：上揚三連音 */
export function beepGoShoot() {
  [988, 1319, 1568].forEach((f, i) =>
    tone(f, i * 0.07, 0.3, "triangle", 0.12)
  );
  vibrate([90, 40, 160]);
}

/** 重射：中性的兩聲下行提示（不是得分也不是失誤） */
export function beepReshoot() {
  tone(520, 0, 0.1, "triangle", 0.09);
  tone(390, 0.12, 0.16, "triangle", 0.09);
  vibrate([60, 60, 60]);
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
