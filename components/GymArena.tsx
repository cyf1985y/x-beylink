"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  challenge,
  enterGym,
  getGymState,
  type GymState,
} from "@/app/ladder/actions";
import { AUTO_CONFIRM_MINUTES, PRESENCE_MINUTES } from "@/lib/ladder";

type MyPlayer = { id: string; nickname: string; avatar: string };

/** 在場名單輪詢間隔 */
const POLL_MS = 10_000;

/**
 * 道館現場：進場（一次性定位）→ 看見在場的人 → 發起挑戰。
 *
 * 座標只在 enterGym 這一次呼叫中當參數傳給伺服器，
 * 不寫 log、不存 state 之外的任何地方、不放進 URL。
 */
export function GymArena({
  gym,
  myPlayers,
}: {
  gym: { id: string; name: string; radiusM: number };
  myPlayers: MyPlayer[];
}) {
  const router = useRouter();
  const [playerId, setPlayerId] = useState(myPlayers[0]?.id ?? "");
  const [state, setState] = useState<GymState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getGymState(gym.id));
    } catch {
      // 輪詢失敗不打擾使用者，下一輪會再試
    }
  }, [gym.id]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const myPresence = state?.myPresence.find((p) => p.playerId === playerId);
  const minutesLeft = myPresence
    ? Math.max(
        0,
        Math.round(
          (new Date(myPresence.expiresAt).getTime() - Date.now()) / 60000
        )
      )
    : null;

  /** 一次性讀取座標並進場（不使用 watchPosition） */
  const handleEnter = () => {
    setError(null);
    setMessage(null);
    if (!playerId) {
      setError("請先選擇要出賽的選手");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("這支裝置或瀏覽器不支援定位，無法進場");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const r = await enterGym(
          gym.id,
          playerId,
          pos.coords.latitude,
          pos.coords.longitude
        );
        setBusy(false);
        if (!r.ok) setError(r.error ?? "進場失敗");
        else setMessage(r.message ?? "已進場");
        refresh();
      },
      (err) => {
        setBusy(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError(
            "你拒絕了定位權限。天梯需要確認你人在道館現場才能進場——請到瀏覽器設定開啟本站的定位權限後再試一次。"
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("抓不到你的位置，請到室外或靠窗處再試一次");
        } else if (err.code === err.TIMEOUT) {
          setError("定位逾時，請再試一次");
        } else {
          setError("定位失敗，請再試一次");
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  };

  const handleChallenge = async (opponentId: string) => {
    setError(null);
    setMessage(null);
    setBusy(true);
    const r = await challenge(gym.id, playerId, opponentId);
    setBusy(false);
    if (!r.ok || !r.matchId) {
      setError(r.error ?? "挑戰失敗");
      refresh();
      return;
    }
    router.push(`/ladder/match/${r.matchId}`);
  };

  const others = (state?.roster ?? []).filter((r) => !r.isMine);

  return (
    <div className="space-y-5">
      {state?.activeMatchId && (
        <button
          onClick={() => router.push(`/ladder/match/${state.activeMatchId}`)}
          className="block w-full rounded-xl border border-cyanx/50 bg-cyanx/10 px-4 py-3 text-sm font-bold text-cyanx"
        >
          ⚔️ 你有一場對戰還沒結束——點此回到現場
        </button>
      )}

      {/* 選手與進場 */}
      <section className="card-x p-5">
        {myPlayers.length > 1 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs text-slate-400">出賽選手</p>
            <div className="flex gap-2">
              {myPlayers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlayerId(p.id)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                    p.id === playerId
                      ? "border-cyanx bg-cyanx/15 text-cyanx"
                      : "border-arena-line text-slate-400"
                  }`}
                >
                  {p.avatar} {p.nickname}
                </button>
              ))}
            </div>
          </div>
        )}

        {minutesLeft !== null && minutesLeft > 0 ? (
          <p className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
            ✅ 已在場，剩餘約 {minutesLeft} 分鐘
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            進場需要確認你在道館 {gym.radiusM} 公尺內，會向你要一次定位權限。
            進場後 {PRESENCE_MINUTES} 分鐘內都能被挑戰。
          </p>
        )}

        <button
          onClick={handleEnter}
          disabled={busy}
          className="btn-x mt-3 w-full disabled:opacity-40"
        >
          {busy
            ? "處理中…"
            : minutesLeft !== null && minutesLeft > 0
              ? "重新進場（延長時間）"
              : "📍 進入道館"}
        </button>

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {message && !error && (
          <p className="mt-3 rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
            ✅ {message}
          </p>
        )}
      </section>

      {/* 在場名單 */}
      <section>
        <h2 className="h-x">現在在場</h2>
        <p className="mt-1 text-xs text-slate-500">每 10 秒自動更新</p>
        <div className="mt-3 space-y-2">
          {others.length === 0 && (
            <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
              目前沒有其他人在場——揪朋友一起進場開打吧！
            </p>
          )}
          {others.map((r) => (
            <div
              key={r.playerId}
              className="flex items-center gap-3 rounded-xl border border-arena-line bg-arena-card p-3"
            >
              <span className="text-3xl">{r.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-black">{r.nickname}</p>
                <p className={`text-sm font-bold ${r.rankText}`}>
                  {r.rankIcon} {r.rankLabel}
                  <span className="ml-2 font-num text-xs text-slate-500">
                    {r.rating}
                  </span>
                </p>
              </div>
              <button
                onClick={() => handleChallenge(r.playerId)}
                disabled={busy || !minutesLeft}
                className="shrink-0 rounded-xl border border-violetx/60 bg-violetx/15 px-3 py-2 text-sm font-black text-violetx transition active:scale-95 disabled:opacity-30"
              >
                挑戰
              </button>
            </div>
          ))}
        </div>
        {!minutesLeft && others.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            要先進場才能發起挑戰。
          </p>
        )}
      </section>

      <p className="text-center text-xs text-slate-600">
        對戰結束由任一方回報比分，敗方確認後才計分；
        {AUTO_CONFIRM_MINUTES} 分鐘未確認會自動成立。
      </p>
    </div>
  );
}
