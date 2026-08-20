"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  challenge,
  enterGym,
  getGymState,
  type GymState,
} from "@/app/ladder/actions";
import { AUTO_CONFIRM_MINUTES, PRESENCE_MINUTES } from "@/lib/ladder";
import { beepNextMatch } from "@/lib/sound";
import { StatusBanner } from "@/components/StatusBanner";

type MyPlayer = { id: string; nickname: string; avatar: string };

/**
 * 在場名單輪詢間隔。
 *
 * 2 秒是為了「被挑戰」這件事：ladder_challenge 沒有對方接受這一步，
 * 比賽建立的當下對手其實還站在道館頁，輪詢太慢他就會一直站在那裡。
 */
const POLL_MS = 2_000;
/** 偵測到對戰後，沒人操作也會自動進場的秒數 */
const AUTO_ENTER_SECONDS = 5;

/**
 * 道館現場：進場（一次性定位）→ 看見在場的人 → 發起挑戰。
 *
 * 座標只在 enterGym 這一次呼叫中當參數傳給伺服器，
 * 不寫 log、不存 state 之外的任何地方、不放進 URL。
 */
export function GymArena({
  gym,
  myPlayers,
  isAdmin = false,
}: {
  gym: { id: string; name: string; radiusM: number };
  myPlayers: MyPlayer[];
  /** 平台管理員：多一顆免定位進場（權限仍由伺服器端再驗一次） */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [playerId, setPlayerId] = useState(myPlayers[0]?.id ?? "");
  const [state, setState] = useState<GymState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * 輪詢計數：2 秒一次，但逾時自動成立的補跑每 15 次（約 30 秒）帶一次就好。
   * 自動成立的門檻是 1 分鐘，每 2 秒掃一次純粹是浪費。
   */
  const polls = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const withMaintenance = polls.current % 15 === 0;
      polls.current += 1;
      setState(await getGymState(gym.id, withMaintenance));
    } catch {
      // 輪詢失敗不打擾使用者，下一輪會再試
    }
  }, [gym.id]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  /**
   * 「我現在該做什麼」：偵測到自己有一場對戰就把人推進計分板。
   *
   * 被挑戰的人完全沒被問過，所以這裡不做「接受／拒絕」——比賽已經成立了，
   * 全螢幕通知只是告訴他發生什麼事，5 秒沒動作就自動進場。
   * 做成不按就不算開始，小孩沒看手機時整個現場都會卡住。
   */
  const active = state?.activeMatch ?? null;
  const activeMatchId = active?.matchId ?? null;
  const [enterIn, setEnterIn] = useState<number | null>(null);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!activeMatchId) {
      announced.current = null;
      setEnterIn(null);
      return;
    }
    if (announced.current === activeMatchId) return;
    announced.current = activeMatchId;
    setEnterIn(AUTO_ENTER_SECONDS);
    beepNextMatch(); // 現場很吵、手機常放在盤邊，純視覺會漏掉
  }, [activeMatchId]);

  useEffect(() => {
    if (enterIn === null || !activeMatchId) return;
    if (enterIn <= 0) {
      router.push(`/ladder/match/${activeMatchId}`);
      return;
    }
    const t = setTimeout(
      () => setEnterIn((n) => (n === null ? null : n - 1)),
      1000
    );
    return () => clearTimeout(t);
  }, [enterIn, activeMatchId, router]);

  /**
   * 把「出賽選手」對齊「現在人在場上的那位」。
   *
   * playerId 初值只能取 myPlayers[0]，而那是帳號裡最早建立的選手，
   * 跟剛才下場的是誰無關。家長＋小孩各一位的帳號打完一場回到道館，
   * 選單會彈回沒進場的那位 → minutesLeft 變 null → 挑戰鈕整個變灰，
   * 橫幅還叫人「先進場」，但他明明剛在這裡打完一場。
   *
   * 只校正一次：之後使用者手動切換選手時，不能被輪詢一直彈回來。
   */
  const alignedToPresence = useRef(false);
  useEffect(() => {
    if (alignedToPresence.current || !state) return;
    alignedToPresence.current = true;
    const present = state.myPresence.find(
      (p) => new Date(p.expiresAt).getTime() > Date.now()
    );
    if (present && present.playerId !== playerId) setPlayerId(present.playerId);
  }, [state, playerId]);

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

  /**
   * 管理員免定位進場：不呼叫 geolocation，座標傳 null。
   * 伺服器端會再驗一次身分，前端這顆按鈕不是權限本身。
   */
  const handleEnterAsAdmin = async () => {
    setError(null);
    setMessage(null);
    if (!playerId) {
      setError("請先選擇要出賽的選手");
      return;
    }
    setBusy(true);
    const r = await enterGym(gym.id, playerId, null, null);
    setBusy(false);
    if (!r.ok) setError(r.error ?? "進場失敗");
    else setMessage(r.message ?? "已進場");
    refresh();
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
    <>
      <div className="space-y-5">
      <StatusBanner tone={minutesLeft ? "info" : "wait"}>
        {minutesLeft
          ? "已進場——點對手右邊的「挑戰」就開打"
          : "先按「進入道館」，才能挑戰別人、也才會被別人挑戰"}
      </StatusBanner>

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

        {isAdmin && (
          <>
            <button
              onClick={handleEnterAsAdmin}
              disabled={busy}
              className="mt-2 w-full rounded-xl border border-dashed border-gold/60 bg-gold/5 py-2.5 text-sm font-bold text-gold transition active:scale-95 disabled:opacity-40"
            >
              🔓 管理員進場（不驗證位置）
            </button>
            <p className="mt-1.5 text-center text-[11px] text-slate-500">
              只有平台管理員看得到這顆；用它進場的對戰一樣會計分。
            </p>
          </>
        )}

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
        <p className="mt-1 text-xs text-slate-500">每 2 秒自動更新</p>
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

      {/*
        對戰已經成立，這層只是「告訴他發生什麼事」，沒有拒絕的選項——
        所以不給關閉鈕，倒數完就自動進場。
      */}
      {active && (
        <div className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-arena-deep/97 p-6 text-center backdrop-blur">
          <p className="text-[13vw] leading-none">{active.opponentAvatar}</p>
          <p className="mt-4 text-2xl font-black text-cyanx text-glow">
            {active.challengedMe ? "⚔️ 有人向你挑戰！" : "⚔️ 對戰進行中"}
          </p>
          <p className="mt-2 text-lg font-black">
            {active.opponentNickname}
            {active.challengedMe ? " 向你發起挑戰" : " 還在等你"}
          </p>

          <button
            onClick={() => router.push(`/ladder/match/${active.matchId}`)}
            className="btn-x mt-8 w-full max-w-xs py-4 text-lg"
          >
            進入對戰
          </button>
          <p className="mt-3 font-num text-sm text-slate-400">
            {enterIn !== null && enterIn > 0
              ? `${enterIn} 秒後自動進入⋯`
              : "進入中⋯"}
          </p>
        </div>
      )}
    </>
  );
}
