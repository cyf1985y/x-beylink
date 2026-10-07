"use client";

/**
 * 回放頁（規格 6.2）：逐局列表、播放該局影片、逐格前進後退、事件時間軸、匯出影片與 JSON。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { effectiveCall, scoreOf, type MatchState } from "@/lib/autoref/match";
import { downloadBlob, storage, type BattleLog } from "@/lib/autoref/storage";
import { FINISH_LABEL, type BattleEvent } from "@/lib/autoref/types";
import { useAutorefData } from "./useAutoref";

const EVENT_LABEL: Record<BattleEvent["kind"], string> = {
  armed: "偵測到手／發射器",
  live: "開局",
  enter: "進區",
  reverse: "復活（取消待確認）",
  disappear: "進區後消失",
  suspect_stop: "疑似停止",
  resume_spin: "恢復旋轉",
  finish_confirmed: "終結成立",
  hand: "手進盤",
  out_of_frame: "出鏡",
  called: "判定",
  manual: "手動",
};

const ZONE_LABEL: Record<string, string> = { IN: "對戰區", XTREME: "極限區", OVER: "出界區", OUT: "盤外" };

export function Replay() {
  const { settings } = useAutorefData();
  const [matches, setMatches] = useState<MatchState[]>([]);
  const [selected, setSelected] = useState<MatchState | null>(null);
  const [battles, setBattles] = useState<BattleLog[]>([]);
  const [current, setCurrent] = useState<BattleLog | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);
  const [videoTime, setVideoTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fps = settings?.camera.fps ?? 30;

  useEffect(() => {
    storage.listMatches().then(setMatches);
  }, []);

  const pickMatch = useCallback(async (m: MatchState) => {
    setSelected(m);
    setCurrent(null);
    setBattles(await storage.listBattles(m.id));
  }, []);

  const pickBattle = useCallback(async (b: BattleLog) => {
    setCurrent(b);
    setHasVideo(null);
    const blob = await storage.getVideo(b.key);
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return blob ? URL.createObjectURL(blob) : null;
    });
    setHasVideo(!!blob);
  }, []);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const stepFrame = (n: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, v.currentTime + n / fps);
  };

  /** 事件時間 → 影片時間（影片從 recordAt 開始錄） */
  const toVideoTime = (t: number) => (current?.recordAt !== null && current?.recordAt !== undefined ? t - current.recordAt : null);
  const seekTo = (t: number) => {
    const v = videoRef.current;
    const vt = toVideoTime(t);
    if (!v || vt === null) return;
    v.pause();
    v.currentTime = Math.max(0, vt);
  };

  const exportJson = async () => {
    if (!selected) return;
    const logs = await storage.listBattles(selected.id);
    const data = { match: selected, battles: logs, exportedAt: new Date().toISOString() };
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `autoref-${selected.id}.json`);
  };

  const exportVideo = async () => {
    if (!current) return;
    const blob = await storage.getVideo(current.key);
    if (!blob) return;
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    downloadBlob(blob, `autoref-${current.key.replace(":", "-")}.${ext}`);
  };

  const deleteMatch = async (m: MatchState) => {
    if (!window.confirm(`刪除這場比賽（${m.names.P1} vs ${m.names.P2}）與其影片？`)) return;
    await storage.deleteMatch(m.id);
    setMatches(await storage.listMatches());
    if (selected?.id === m.id) {
      setSelected(null);
      setBattles([]);
      setCurrent(null);
    }
  };

  if (!selected) {
    return (
      <div className="space-y-3">
        {matches.length === 0 && <p className="text-sm text-slate-400">還沒有比賽紀錄。</p>}
        <ul className="space-y-2">
          {matches.map((m) => {
            const s = scoreOf(m);
            return (
              <li key={m.id} className="card-x flex items-center justify-between gap-2 p-3 text-sm">
                <button type="button" className="flex-1 text-left" onClick={() => pickMatch(m)}>
                  <div className="font-bold">
                    {m.names.P1} <span className="font-num text-cyanx">{s.P1}</span> : <span className="font-num text-cyanx">{s.P2}</span> {m.names.P2}
                  </div>
                  <div className="text-xs text-slate-400">
                    {new Date(m.createdAt).toLocaleString("zh-TW")} · {m.battles.length} 局
                  </div>
                </button>
                <button type="button" className="text-xs text-red-300 underline" onClick={() => deleteMatch(m)}>
                  刪除
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const names = selected.names;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <button type="button" className="text-cyanx underline" onClick={() => setSelected(null)}>
          ← 所有比賽
        </button>
        <button type="button" className="rounded-lg border border-arena-line px-3 py-1" onClick={exportJson}>
          匯出 JSON
        </button>
      </div>

      <ul className="card-x divide-y divide-arena-line text-sm">
        {selected.battles.map((b, i) => {
          const c = effectiveCall(b) ?? b.auto;
          const log = battles.find((x) => x.battle === b.auto.battle);
          return (
            <li key={i} className={`flex items-center justify-between gap-2 px-3 py-2 ${current?.battle === b.auto.battle ? "bg-cyanx/10" : ""}`}>
              <button type="button" className="flex-1 text-left" onClick={() => log && pickBattle(log)}>
                <span className="text-slate-400">第 {b.auto.battle} 局</span>{" "}
                <span className={b.voided ? "line-through text-slate-500" : ""}>
                  {FINISH_LABEL[c.result]}
                  {c.winner && `，${names[c.winner]} +${c.points}`}
                </span>
                {b.override && <span className="ml-1 text-xs text-gold">改判</span>}
                {b.voided && <span className="ml-1 text-xs text-slate-400">重賽不計分</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {current && (
        <div className="space-y-3">
          <div className="card-x overflow-hidden bg-black">
            {hasVideo === false && <p className="p-6 text-center text-sm text-slate-400">這一局沒有錄影</p>}
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                className="block w-full"
                controls
                playsInline
                onTimeUpdate={(e) => setVideoTime(e.currentTarget.currentTime)}
              />
            )}
          </div>
          {videoUrl && (
            <div className="grid grid-cols-4 gap-2 text-sm">
              <button type="button" className="rounded-xl border border-arena-line py-2 font-bold" onClick={() => stepFrame(-1)}>
                ◀ 上一格
              </button>
              <button type="button" className="rounded-xl border border-arena-line py-2 font-bold" onClick={() => stepFrame(1)}>
                下一格 ▶
              </button>
              <span className="col-span-1 self-center text-center font-num text-slate-300">{videoTime.toFixed(2)} s</span>
              <button type="button" className="rounded-xl border border-arena-line py-2 font-bold" onClick={exportVideo}>
                匯出影片
              </button>
            </div>
          )}

          <div className="card-x p-3 text-sm">
            <p className="font-bold">
              {FINISH_LABEL[current.call.result]}
              {current.call.winner && `，${names[current.call.winner]} 得 ${current.call.points} 分`}
            </p>
            <p className="text-xs text-slate-400">
              標記：{current.call.flags.length ? current.call.flags.join("、") : "—"} · 信心 {current.call.confidence}
            </p>
            <ol className="mt-2 space-y-1">
              {current.events.map((e, i) => {
                const rel = current.liveAt !== null ? e.t - current.liveAt : null;
                return (
                  <li key={i} className="flex items-center gap-2">
                    <button type="button" className="font-num w-16 text-right text-cyanx underline disabled:no-underline disabled:text-slate-500" onClick={() => seekTo(e.t)} disabled={!videoUrl || toVideoTime(e.t) === null}>
                      {rel === null ? "—" : `${rel >= 0 ? "+" : ""}${rel.toFixed(2)}`}
                    </button>
                    <span>
                      {EVENT_LABEL[e.kind]}
                      {e.bey && ` ${e.bey}`}
                      {e.zone && e.kind !== "called" && ` ${ZONE_LABEL[e.zone] ?? e.zone}`}
                      {e.note && <span className="text-slate-400">（{e.note}）</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
