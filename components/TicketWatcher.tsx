"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 憑證頁的報到偵測：每 3 秒查一次報到狀態，
 * 主辦方掃碼成功後這裡會自動顯示「報到成功」並跳轉到對戰表頁。
 */
export function TicketWatcher({
  regId,
  eventId,
}: {
  regId: string;
  eventId: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [hasBracket, setHasBracket] = useState(false);

  useEffect(() => {
    let stop = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/ticket/${regId}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: { checkedIn: boolean; hasBracket: boolean } =
          await res.json();
        if (data.checkedIn && !stop) {
          stop = true;
          clearInterval(timer);
          setHasBracket(data.hasBracket);
          setDone(true);
          try {
            navigator.vibrate?.([100, 60, 100]);
          } catch {
            /* ignore */
          }
          setTimeout(() => {
            // 對戰表已產生就直接看晉級圖，否則回賽事頁等待
            router.replace(
              data.hasBracket ? `/event/${eventId}/bracket` : `/event/${eventId}`
            );
          }, 1800);
        }
      } catch {
        /* 網路失敗下一輪再試 */
      }
    }, 3000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [regId, eventId, router]);

  if (!done) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-arena-deep/90 backdrop-blur-sm">
      <div className="animate-glow-pulse rounded-3xl border-2 border-emerald-400/70 bg-arena-card px-10 py-12 text-center shadow-glow-strong">
        <p className="text-6xl">✅</p>
        <p className="mt-4 text-2xl font-black text-emerald-300">報到成功！</p>
        <p className="mt-2 text-sm text-slate-400">
          {hasBracket ? "正在前往對戰表…" : "對戰表尚未公布，先回賽事頁…"}
        </p>
      </div>
    </div>
  );
}
