"use client";

/**
 * 對戰頁（規格 6.2）：即時畫面＋疊圖、比分、判定卡、手動按鈕、每局錄影。
 *
 * 畫格流程：video → FrameGrabber（裁切縮放）→ VisionClient（Worker）→ FrameObs
 * → RefereeEngine（主執行緒，純邏輯）→ 判定卡／比分／語音。
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BattleRecorder,
  FrameGrabber,
  VisionClient,
  cameraFps,
  onEachFrame,
  openCamera,
  stopCamera,
} from "@/lib/autoref/client";
import {
  addBattle,
  confirmBattle,
  effectiveCall,
  matchWinner,
  newMatch,
  overrideBattle,
  scoreOf,
  voidBattle,
  type MatchState,
} from "@/lib/autoref/match";
import { RefereeEngine } from "@/lib/autoref/rules";
import { storage, type BattleLog } from "@/lib/autoref/storage";
import {
  FINISH_LABEL,
  type BattleCall,
  type BattleEvent,
  type BattleState,
  type BeyId,
  type FinishResult,
  type PlayerId,
} from "@/lib/autoref/types";
import type { FrameResult } from "@/lib/autoref/vision/worker";
import { beepScore, fanfare, speak, unlockAudio } from "@/lib/sound";
import { drawMask, drawTracks, drawZones } from "./overlay";
import { fmtSec, useAutorefData } from "./useAutoref";

const STATE_LABEL: Record<BattleState, string> = {
  IDLE: "待機：等待發射",
  ARMED: "準備：偵測到手／發射器",
  LIVE: "對戰中",
  CALLED: "已判定",
};

const PLAYER_LABEL: Record<PlayerId, string> = { P1: "選手 1", P2: "選手 2" };

function describeCall(c: BattleCall, names: Record<PlayerId, string>): string {
  if (c.result === "DRAW") return "平手，重賽";
  if (c.result === "NO_CALL") {
    if (c.flags.includes("hand_before_call")) return "無法判定：手在判定前進入";
    if (c.flags.includes("out_of_frame")) return "無法判定：陀螺出鏡，建議重賽";
    return "無法判定";
  }
  const who = c.winner ? names[c.winner] : "";
  return `${FINISH_LABEL[c.result]}，${who} 得 ${c.points} 分`;
}

/** 判定卡上的旗標說明 */
const FLAG_LABEL: Record<string, string> = {
  hand_early: "手提前進入（以疑似終結判定）",
  hand_before_call: "手在判定前進入",
  out_of_frame: "陀螺出鏡",
  simultaneous: "同時發生",
  manual: "手動",
  confirm_stopped: "區內停止確認",
  confirm_vanished: "進區後消失確認",
  confirm_stayed: "留在區內逾時確認",
  confirm_spin: "轉停確認",
};

function flagText(f: string): string {
  if (f.startsWith("reverse_x")) return `復活 ${f.slice(9)} 次`;
  return FLAG_LABEL[f] ?? f;
}

interface Stats {
  camFps: number | null;
  procFps: number;
  ms: number;
  dropped: number;
}

export function Battle() {
  const { settings, calibration } = useAutorefData();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<VisionClient | null>(null);
  const grabberRef = useRef<FrameGrabber | null>(null);
  const engineRef = useRef<RefereeEngine | null>(null);
  const recorderRef = useRef<BattleRecorder | null>(null);
  const matchRef = useRef<MatchState | null>(null);
  const recordAtRef = useRef<number | null>(null);
  const lastStateRef = useRef<BattleState>("IDLE");
  const frameCountRef = useRef({ n: 0, t: 0 });
  const lastTRef = useRef(0);

  const [match, setMatch] = useState<MatchState | null>(null);
  const [engineState, setEngineState] = useState<BattleState>("IDLE");
  const [card, setCard] = useState<{ call: BattleCall; index: number; liveAt: number | null } | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [burstPick, setBurstPick] = useState(false);
  const [stats, setStats] = useState<Stats>({ camFps: null, procFps: 0, ms: 0, dropped: 0 });
  const [shaken, setShaken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveSec, setLiveSec] = useState<number | null>(null);
  const [newNames, setNewNames] = useState<{ P1: string; P2: string } | null>(null);
  const [ready, setReady] = useState(false);

  const persistMatch = useCallback(async (m: MatchState) => {
    matchRef.current = m;
    setMatch(m);
    await storage.putMatch(m);
    await storage.putCurrentMatchId(m.id);
  }, []);

  // 載入或建立目前的比賽
  useEffect(() => {
    if (!settings) return;
    (async () => {
      const id = await storage.getCurrentMatchId();
      const m = id ? await storage.getMatch(id) : null;
      if (m && !matchWinner(m)) {
        matchRef.current = m;
        setMatch(m);
      } else {
        await persistMatch(newMatch(settings.rules.winScore));
      }
    })();
  }, [settings, persistMatch]);

  const speakCall = useCallback(
    (c: BattleCall, names: Record<PlayerId, string>) => {
      if (c.winner) {
        beepScore(c.winner === "P1" ? 1 : 2, Math.max(1, c.points));
      }
      if (settings?.speech) speak(describeCall(c, names));
    },
    [settings?.speech]
  );

  /** 判定產生：加入比分、存事件、停止錄影、顯示判定卡 */
  const handleCall = useCallback(
    async (call: BattleCall, events: BattleEvent[], liveAt: number | null) => {
      const m = matchRef.current;
      if (!m) return;
      const key = `${m.id}:${call.battle}`;
      const next = addBattle(m, call, key);
      await persistMatch(next);
      setCard({ call, index: next.battles.length - 1, liveAt });
      speakCall(call, next.names);
      const log: BattleLog = {
        key,
        matchId: m.id,
        battle: call.battle,
        call,
        events,
        liveAt,
        recordAt: recordAtRef.current,
        createdAt: Date.now(),
      };
      await storage.putBattle(log);
      // 錄影多留 1 秒再停
      const rec = recorderRef.current;
      if (rec?.recording) {
        setTimeout(async () => {
          const blob = await rec.stop();
          if (blob) await storage.putVideo(key, blob);
        }, 1000);
      }
      if (matchWinner(next)) fanfare();
    },
    [persistMatch, speakCall]
  );

  const onFrame = useCallback(
    (r: FrameResult) => {
      const engine = engineRef.current;
      const canvas = overlayRef.current;
      if (!engine || !settings || !calibration) return;
      const prevState = engine.state;
      const step = engine.update(r.obs);
      // 狀態轉換
      if (engine.state !== prevState) {
        if (engine.state === "ARMED") {
          clientRef.current?.resetTracks();
          if (settings.record && recorderRef.current && !recorderRef.current.recording) {
            recorderRef.current.start();
            recordAtRef.current = r.obs.t;
          }
        }
        if (engine.state === "IDLE") {
          // 上一局結束，局號跟著比分走
          const m = matchRef.current;
          if (m) engine.battleNo = m.battles.length + 1;
        }
        lastStateRef.current = engine.state;
        setEngineState(engine.state);
      }
      if (step.call) handleCall(step.call, engine.events.slice(), engine.liveAt);
      setLiveSec(engine.state === "LIVE" && engine.liveAt !== null ? r.obs.t - engine.liveAt : null);
      setShaken(r.debug.shaken);

      // 疊圖
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (settings.debug && r.mask) {
            drawMask(ctx, new Uint8Array(r.mask), canvas.width, canvas.height);
          }
          drawZones(ctx, calibration.zones);
          const labels: Record<BeyId, string> = {
            A: `A·${matchRef.current?.names[engine.owners.A] ?? engine.owners.A}`,
            B: `B·${matchRef.current?.names[engine.owners.B] ?? engine.owners.B}`,
          };
          drawTracks(ctx, r.debug.tracks, labels, engine.state === "LIVE" ? engine.snapshot() : null, settings.debug);
        }
      }
      // 統計
      const fc = frameCountRef.current;
      fc.n += 1;
      const now = performance.now();
      if (now - fc.t > 1000) {
        setStats({
          camFps: cameraFps(streamRef.current),
          procFps: Math.round((fc.n * 1000) / (now - fc.t)),
          ms: Math.round(r.debug.ms),
          dropped: clientRef.current?.dropped ?? 0,
        });
        fc.n = 0;
        fc.t = now;
      }
    },
    [settings, calibration, handleCall]
  );

  // 相機、Worker、取格迴圈
  useEffect(() => {
    if (!settings || !calibration) return;
    const video = videoRef.current;
    if (!video) return;
    let stopLoop: (() => void) | null = null;
    let cancelled = false;
    const client = new VisionClient();
    clientRef.current = client;
    client.onError = (m) => setError(m);
    engineRef.current = new RefereeEngine(settings.rules, (matchRef.current?.battles.length ?? 0) + 1);

    (async () => {
      try {
        const stream = await openCamera(video, settings.camera);
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        recorderRef.current = new BattleRecorder(stream);
        await client.init(calibration, settings.vision);
        grabberRef.current = new FrameGrabber(calibration.crop, calibration.width, calibration.height);
        const canvas = overlayRef.current;
        if (canvas) {
          canvas.width = calibration.width;
          canvas.height = calibration.height;
        }
        client.onFrame = onFrame;
        setReady(true);
        stopLoop = onEachFrame(video, (_now, mediaTime) => {
          const g = grabberRef.current;
          if (!g || cancelled) return;
          // mediaTime 偶爾不單調（rAF 退路），保險起見夾住
          const t = mediaTime > lastTRef.current ? mediaTime : lastTRef.current + 1 / 60;
          lastTRef.current = t;
          const img = g.grab(video);
          client.pushFrame(img, t, settings.debug);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      stopLoop?.();
      stopCamera(streamRef.current);
      streamRef.current = null;
      client.terminate();
      clientRef.current = null;
      setReady(false);
    };
    // onFrame 依賴 settings/calibration，與這裡相同
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, calibration]);

  // 判定卡操作
  const closeCard = () => {
    setCard(null);
    setOverriding(false);
  };
  const confirm = async () => {
    if (!card || !matchRef.current) return;
    await persistMatch(confirmBattle(matchRef.current, card.index));
    closeCard();
  };
  const voidIt = async () => {
    if (!card || !matchRef.current) return;
    await persistMatch(voidBattle(matchRef.current, card.index));
    closeCard();
  };
  const override = async (result: FinishResult, winner: PlayerId | null) => {
    if (!card || !matchRef.current || !settings) return;
    const scorable = result !== "DRAW" && result !== "NO_CALL";
    const call: BattleCall = {
      ...card.call,
      result,
      winner: scorable ? winner : null,
      points: scorable ? settings.rules.points[result] : 0,
      flags: [...card.call.flags.filter((f) => f !== "manual"), "override"],
      t_called: card.call.t_called,
    };
    await persistMatch(overrideBattle(matchRef.current, card.index, call));
    closeCard();
  };

  // 手動操作
  const manualStart = () => {
    unlockAudio();
    engineRef.current?.manualStart(lastTRef.current);
    clientRef.current?.resetTracks();
    if (settings?.record && recorderRef.current && !recorderRef.current.recording) {
      recorderRef.current.start();
      recordAtRef.current = lastTRef.current;
    }
    setEngineState("LIVE");
  };
  const resetBattle = () => {
    engineRef.current?.reset(lastTRef.current);
    setEngineState("IDLE");
  };
  const swap = () => {
    engineRef.current?.swapOwners();
    setEngineState((s) => s); // 觸發重繪
  };
  const burst = (loser: BeyId) => {
    const engine = engineRef.current;
    if (!engine) return;
    setBurstPick(false);
    const call = engine.manualCall("BURST_FINISH", loser, lastTRef.current);
    handleCall(call, engine.events.slice(), engine.liveAt);
    setEngineState("CALLED");
  };
  const startNewMatch = async () => {
    if (!settings) return;
    const names = newNames ?? { P1: "選手 1", P2: "選手 2" };
    await persistMatch(newMatch(settings.rules.winScore, names));
    setNewNames(null);
    if (engineRef.current) {
      engineRef.current.reset(lastTRef.current);
      engineRef.current.battleNo = 1;
    }
    setEngineState("IDLE");
  };

  if (settings && calibration === null) {
    return (
      <div className="card-x space-y-3 p-5 text-center">
        <p className="text-lg font-bold">尚未校正</p>
        <p className="text-sm text-slate-300">先到校正頁拍空盤背景、框出區域、量測陀螺面積。</p>
        <Link href="/autoref/calibrate" className="btn-x inline-block">
          前往校正
        </Link>
      </div>
    );
  }

  const score = match ? scoreOf(match) : { P1: 0, P2: 0 };
  const winner = match ? matchWinner(match) : null;
  const owners = engineRef.current?.owners ?? { A: "P1" as PlayerId, B: "P2" as PlayerId };

  return (
    <div className="space-y-3">
      {/* 比分 */}
      <div className="card-x p-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          {(["P1", "P2"] as PlayerId[]).map((p, i) => (
            <div key={p} className={i === 1 ? "order-3" : ""}>
              <div className={`truncate text-sm font-bold ${p === "P1" ? "text-bluex" : "text-red-400"}`}>
                {match?.names[p] ?? PLAYER_LABEL[p]}
              </div>
              <div className={`font-num text-5xl font-bold ${winner === p ? "text-gold text-glow" : ""}`}>{score[p]}</div>
            </div>
          ))}
          <div className="order-2 text-xs text-slate-400">
            先得 {match?.winScore ?? settings?.rules.winScore ?? 4} 分
            <br />第 {engineRef.current?.battleNo ?? (match?.battles.length ?? 0) + 1} 局
          </div>
        </div>
        {winner && (
          <p className="mt-2 text-center text-sm font-bold text-gold">
            {match?.names[winner]} 獲勝！
            <button type="button" className="ml-3 underline" onClick={() => setNewNames({ P1: match?.names.P1 ?? "", P2: match?.names.P2 ?? "" })}>
              開始新比賽
            </button>
          </p>
        )}
      </div>

      {/* 畫面 */}
      <div className="card-x relative overflow-hidden bg-black">
        <video ref={videoRef} className="block w-full" autoPlay muted playsInline />
        {calibration && (
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute"
            style={{
              left: `${(calibration.crop.x / (videoRef.current?.videoWidth || calibration.crop.x + calibration.crop.w)) * 100}%`,
              top: `${(calibration.crop.y / (videoRef.current?.videoHeight || calibration.crop.y + calibration.crop.h)) * 100}%`,
              width: `${(calibration.crop.w / (videoRef.current?.videoWidth || calibration.crop.x + calibration.crop.w)) * 100}%`,
              height: `${(calibration.crop.h / (videoRef.current?.videoHeight || calibration.crop.y + calibration.crop.h)) * 100}%`,
            }}
          />
        )}
        <div className="absolute left-2 top-2 flex flex-col gap-1 text-xs">
          <span
            className={`rounded px-2 py-0.5 font-bold ${
              engineState === "LIVE" ? "bg-cyanx text-arena-deep" : engineState === "CALLED" ? "bg-gold text-arena-deep" : "bg-black/60 text-slate-200"
            }`}
          >
            {STATE_LABEL[engineState]}
            {liveSec !== null && ` ${liveSec.toFixed(1)}s`}
          </span>
          {shaken && <span className="rounded bg-red-600/90 px-2 py-0.5 font-bold">畫面大面積變化：鏡頭晃動或光線改變，請重新校正</span>}
        </div>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-slate-200">
          {stats.camFps ? `相機 ${Math.round(stats.camFps)}` : "相機 –"} / 處理 {stats.procFps} fps · {stats.ms} ms
          {stats.dropped > 0 && ` · 丟 ${stats.dropped}`}
        </span>
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-slate-200">開啟相機中…</div>
        )}
      </div>

      {error && <p className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      {/* 手動按鈕 */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <button type="button" className="rounded-xl border border-cyanx/60 px-3 py-3 font-bold text-cyanx disabled:opacity-40" onClick={manualStart} disabled={engineState === "LIVE"}>
          開始這一局
        </button>
        <button type="button" className="rounded-xl border border-gold/60 px-3 py-3 font-bold text-gold disabled:opacity-40" onClick={() => setBurstPick(true)} disabled={engineState !== "LIVE"}>
          爆裂終結
        </button>
        <button type="button" className="rounded-xl border border-arena-line px-3 py-3 font-bold" onClick={swap}>
          對調選手（A={match?.names[owners.A] ?? owners.A}）
        </button>
        <button type="button" className="rounded-xl border border-arena-line px-3 py-3 font-bold" onClick={resetBattle}>
          重設本局
        </button>
      </div>
      <button type="button" className="w-full rounded-xl border border-arena-line px-3 py-2 text-xs text-slate-400" onClick={() => setNewNames({ P1: match?.names.P1 ?? "", P2: match?.names.P2 ?? "" })}>
        新比賽／改選手名稱
      </button>

      {/* 本場各局 */}
      {match && match.battles.length > 0 && (
        <ul className="card-x divide-y divide-arena-line text-sm">
          {match.battles.map((b, i) => {
            const c = effectiveCall(b);
            return (
              <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-slate-400">第 {b.auto.battle} 局</span>
                <span className={`flex-1 ${b.voided ? "line-through text-slate-500" : ""}`}>
                  {c ? describeCall(c, match.names) : describeCall(b.auto, match.names)}
                  {b.override && <span className="ml-1 text-xs text-gold">改判</span>}
                </span>
                <button type="button" className="text-xs text-cyanx underline" onClick={() => setCard({ call: c ?? b.auto, index: i, liveAt: null })}>
                  檢視
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 爆裂：選哪一顆爆裂 */}
      {burstPick && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setBurstPick(false)}>
          <div className="card-x w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-center font-bold">哪一顆陀螺爆裂了？</p>
            {(["A", "B"] as BeyId[]).map((id) => (
              <button key={id} type="button" className="btn-x w-full" onClick={() => burst(id)}>
                {id}・{match?.names[owners[id]] ?? owners[id]}（對手得 {settings?.rules.points.BURST_FINISH ?? 2} 分）
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 新比賽 */}
      {newNames && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div className="card-x w-full max-w-sm space-y-3 p-5">
            <p className="font-bold">新比賽</p>
            {(["P1", "P2"] as PlayerId[]).map((p) => (
              <input
                key={p}
                value={newNames[p]}
                onChange={(e) => setNewNames({ ...newNames, [p]: e.target.value })}
                placeholder={PLAYER_LABEL[p]}
                className="w-full rounded-lg border border-arena-line bg-arena-deep px-3 py-2"
              />
            ))}
            <div className="flex gap-2">
              <button type="button" className="flex-1 rounded-xl border border-arena-line px-4 py-3 font-bold" onClick={() => setNewNames(null)}>
                取消
              </button>
              <button type="button" className="btn-x flex-1" onClick={startNewMatch}>
                開始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 判定卡 */}
      {card && match && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 sm:items-center">
          <div className="card-x w-full max-w-md space-y-3 p-5">
            <p className="text-xs text-slate-400">第 {card.call.battle} 局</p>
            <p className={`text-center text-3xl font-black ${card.call.winner === "P1" ? "text-bluex" : card.call.winner === "P2" ? "text-red-400" : "text-slate-200"}`}>
              {FINISH_LABEL[card.call.result]}
            </p>
            <p className="text-center text-lg">{describeCall(card.call, match.names)}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300">
              <dt>終結時間</dt>
              <dd>{fmtSec(card.call.t_event !== null && card.liveAt !== null ? card.call.t_event - card.liveAt : null)}（相對開局）</dd>
              <dt>判定延遲</dt>
              <dd>{card.call.t_event !== null ? `${(card.call.t_called - card.call.t_event).toFixed(2)} 秒` : "—"}</dd>
              <dt>信心</dt>
              <dd>{card.call.confidence === "high" ? "高" : card.call.confidence === "medium" ? "中" : "低"}</dd>
              <dt>標記</dt>
              <dd>{card.call.flags.length ? card.call.flags.map(flagText).join("、") : "—"}</dd>
            </dl>
            {!overriding ? (
              <div className="grid grid-cols-3 gap-2">
                <button type="button" className="btn-x" onClick={confirm}>
                  確認
                </button>
                <button type="button" className="rounded-xl border border-gold/60 px-3 py-3 font-bold text-gold" onClick={() => setOverriding(true)}>
                  改判
                </button>
                <button type="button" className="rounded-xl border border-arena-line px-3 py-3 font-bold" onClick={voidIt}>
                  重賽不計分
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-slate-300">改判為：</p>
                {(["XTREME_FINISH", "OVER_FINISH", "BURST_FINISH", "SPIN_FINISH"] as FinishResult[]).map((r) => (
                  <div key={r} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm">
                    <span>{FINISH_LABEL[r]}</span>
                    {(["P1", "P2"] as PlayerId[]).map((p) => (
                      <button key={p} type="button" className={`rounded-lg border px-3 py-2 font-bold ${p === "P1" ? "border-bluex text-bluex" : "border-red-400 text-red-400"}`} onClick={() => override(r, p)}>
                        {match.names[p]} 得分
                      </button>
                    ))}
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="rounded-xl border border-arena-line px-3 py-2 font-bold" onClick={() => override("DRAW", null)}>
                    平手重賽
                  </button>
                  <button type="button" className="rounded-xl border border-arena-line px-3 py-2 font-bold" onClick={() => setOverriding(false)}>
                    返回
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
