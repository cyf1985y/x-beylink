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
 * 解鎖／喚醒 AudioContext。
 * 倒數的後三拍是由 timer 觸發的，必須在使用者按下按鈕的當下先把 context 叫醒，
 * 否則 iOS Safari 會把之後排定的聲音全部吞掉。
 */
export function resumeAudio() {
  try {
    void ctx()?.resume?.();
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

/** 重射：兩聲下滑的中性提示音（不是得分、也不是扣分） */
export function beepReshoot() {
  tone(420, 0, 0.1, "sawtooth", 0.06);
  tone(300, 0.1, 0.16, "sawtooth", 0.06);
  vibrate([40, 40, 40]);
}

/** 倒數 3、2、1：一拍一聲，越接近 GO 越高 */
export function beepCountdown(n: 3 | 2 | 1) {
  tone(440 + (3 - n) * 90, 0, 0.18, "square", 0.1);
  vibrate(70);
}

/** GO SHOOT！：拉高的雙音 */
export function beepGoShoot() {
  tone(880, 0, 0.12, "square", 0.11);
  tone(1319, 0.1, 0.3, "triangle", 0.12);
  vibrate([90, 50, 200]);
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
