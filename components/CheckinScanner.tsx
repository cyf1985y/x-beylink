"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { checkinByToken, type CheckinResult } from "@/app/host/actions";

type ScanFeedback = { kind: "ok" | "already" | "error"; text: string } | null;

export function CheckinScanner({ eventId }: { eventId: string }) {
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
          setFeedback({
            kind: "already",
            text: `${result.nickname} 剛才已經報到過了`,
          });
        } else if (result.ok) {
          setFeedback({ kind: "ok", text: `✅ ${result.nickname} 報到成功！` });
        } else {
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
    [eventId]
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
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            feedback.kind === "ok"
              ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
              : feedback.kind === "already"
                ? "border-gold/50 bg-gold/10 text-gold"
                : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
