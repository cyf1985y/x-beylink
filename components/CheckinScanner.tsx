"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { checkinByToken, type CheckinResult } from "@/app/host/actions";

type ScanFeedback = { kind: "ok" | "already" | "error"; text: string } | null;

/** 掃碼音效：成功嗶一聲（高音）、失敗低音兩短聲；並震動 */
function playBeep(ok: boolean) {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + start + dur
      );
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    if (ok) {
      tone(1320, 0, 0.18);
    } else {
      tone(220, 0, 0.12);
      tone(220, 0.18, 0.12);
    }
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* 不支援音效就略過 */
  }
  try {
    navigator.vibrate?.(ok ? 120 : [80, 60, 80]);
  } catch {
    /* ignore */
  }
}

export function CheckinScanner({ eventId }: { eventId: string }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastTokenRef = useRef<string>("");

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ScanFeedback>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const handleToken = useCallback(
    async (raw: string) => {
      if (busyRef.current) return;
      // 同一張 QR 連續入鏡不重複送
      if (raw === lastTokenRef.current) return;
      busyRef.current = true;
      lastTokenRef.current = raw;
      try {
        const result: CheckinResult = await checkinByToken(eventId, raw);
        if (result.ok && result.already) {
          playBeep(false);
          setFeedback({
            kind: "already",
            text: `${result.nickname} 剛才已經報到過了`,
          });
        } else if (result.ok) {
          playBeep(true);
          setFeedback({ kind: "ok", text: `✅ ${result.nickname} 報到成功！` });
          router.refresh(); // 報到名單即時更新
        } else {
          playBeep(false);
          setFeedback({ kind: "error", text: result.error ?? "報到失敗" });
        }
      } finally {
        // 3 秒後允許再掃（含同一張重掃）
        setTimeout(() => {
          busyRef.current = false;
          lastTokenRef.current = "";
        }, 3000);
      }
    },
    [eventId, router]
  );

  const start = useCallback(async () => {
    setCameraError(null);
    setFeedback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      const tick = () => {
        if (!streamRef.current) return;
        const canvas = canvasRef.current;
        if (canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
          const w = (canvas.width = video.videoWidth);
          const h = (canvas.height = video.videoHeight);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx && w > 0 && h > 0) {
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, {
              inversionAttempts: "dontInvert",
            });
            if (code?.data?.startsWith("xb-checkin:")) {
              void handleToken(code.data);
            }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setCameraError(
        "無法開啟相機——請確認已允許相機權限，或改用名單上的「手動報到」。"
      );
    }
  }, [handleToken]);

  return (
    <div className="rounded-2xl border border-arena-line bg-arena-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-cyanx">📷 掃碼報到</h3>
        {scanning ? (
          <button
            onClick={stop}
            className="rounded-lg border border-arena-line px-3 py-1.5 text-sm text-slate-400 hover:text-red-300"
          >
            關閉相機
          </button>
        ) : (
          <button
            onClick={start}
            className="rounded-lg bg-cyanx px-3 py-1.5 text-sm font-bold text-arena hover:brightness-110"
          >
            開啟相機
          </button>
        )}
      </div>

      {cameraError && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {cameraError}
        </p>
      )}

      <div className={scanning ? "mt-3" : "hidden"}>
        <video
          ref={videoRef}
          className="w-full rounded-xl"
          muted
          playsInline
        />
        <canvas ref={canvasRef} className="hidden" />
        <p className="mt-2 text-center text-xs text-slate-500">
          對準選手的報到 QR Code
        </p>
      </div>

      {feedback && (
        <p
          className={`mt-3 rounded-xl border-2 px-3 py-3 text-center text-base font-black ${
            feedback.kind === "ok"
              ? "animate-glow-pulse border-emerald-400/70 bg-emerald-400/15 text-emerald-300"
              : feedback.kind === "already"
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-red-500/60 bg-red-500/10 text-red-300"
          }`}
        >
          {feedback.text}
          {feedback.kind === "ok" && (
            <span className="mt-0.5 block text-xs font-normal text-slate-400">
              名單已更新，可繼續掃下一位
            </span>
          )}
        </p>
      )}
    </div>
  );
}
