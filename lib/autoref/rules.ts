/**
 * 自動裁判規則引擎（規格第 3 節）。
 *
 * 純函式風格的狀態機：輸入每格的 FrameObs，輸出判定事件。
 * 不依賴 DOM、相機或 OpenCV，可用錄好的事件紀錄做單元測試（rules.test.ts）。
 *
 * 一局的狀態：IDLE → ARMED → LIVE → CALLED → IDLE …
 */
import {
  DEFAULT_RULE_CONFIG,
  type BattleCall,
  type BattleEvent,
  type BattleState,
  type BeyId,
  type BeyObs,
  type Confidence,
  type FinishResult,
  type FrameObs,
  type PlayerId,
  type RuleConfig,
  type Zone,
} from "./types.ts";

/**
 * 一段「停止」觀測：只有本格確實看到且量到停止才累計；看不到、黏合、量不到的格
 * 只增加 gap，gap 超過上限就整段歸零。沒有觀測的時間不算證據。
 */
interface StopRun {
  /** 首次觀測到停止的時間（終結時間用） */
  since: number;
  /** 有效停止觀測累計的秒數 */
  validSec: number;
  /** 目前連續沒有有效觀測的格數 */
  gap: number;
}

/** 進區後尚未確認的終結 */
interface PendingEntry {
  zone: "XTREME" | "OVER";
  tEnter: number;
  /** 在區內停止旋轉的觀測 */
  stop: StopRun | null;
  /** 進區後從畫面消失的時間 */
  vanishedAt: number | null;
}

/** 已成立（或已確定無法判定）的候選終結 */
interface Candidate {
  bey: BeyId;
  result: FinishResult;
  tEvent: number;
  /** true = 已確認；false = 仍在等確認（疑似停止、進區待確認、出鏡待確認） */
  resolved: boolean;
  how?: string;
}

interface Track {
  id: BeyId;
  zone: Zone;
  visible: boolean;
  spinning: boolean | null;
  lastSeenT: number;
  pending: PendingEntry | null;
  reverses: number;
  /** 對戰區內的停止觀測（疑似轉停） */
  stop: StopRun | null;
  /** 從非口袋位置離開畫面的時間 */
  outSince: number | null;
  /** 回到對戰區後持續旋轉的起始時間（復活判定用） */
  inSpinSince: number | null;
  /** 已確認的終結 */
  confirmed: Candidate | null;
}

export interface EngineStep {
  /** 本格產生的判定（一局只會有一次） */
  call: BattleCall | null;
  /** 本格新增的事件 */
  events: BattleEvent[];
}

const BEYS: BeyId[] = ["A", "B"];

function other(id: BeyId): BeyId {
  return id === "A" ? "B" : "A";
}

function newTrack(id: BeyId, t: number): Track {
  return {
    id,
    zone: "IN",
    visible: true,
    spinning: true,
    lastSeenT: t,
    pending: null,
    reverses: 0,
    stop: null,
    outSince: null,
    inSpinSince: null,
    confirmed: null,
  };
}

export class RefereeEngine {
  readonly config: RuleConfig;
  state: BattleState = "IDLE";
  battleNo: number;
  /** 陀螺 → 選手的對應，開局時依發射位置記錄，操作者可一鍵對調 */
  owners: Record<BeyId, PlayerId> = { A: "P1", B: "P2" };
  /** 本局的事件時間軸 */
  events: BattleEvent[] = [];
  /** 本局的判定 */
  call: BattleCall | null = null;
  /** LIVE 的開始時間 */
  liveAt: number | null = null;

  private prevT: number | null = null;
  private lastDt = 1 / 30;
  private quietSince: number | null = null;
  private twoSpinningSince: number | null = null;
  private tracks: Record<BeyId, Track> = {
    A: newTrack("A", 0),
    B: newTrack("B", 0),
  };

  constructor(config: Partial<RuleConfig> = {}, battleNo = 1) {
    this.config = { ...DEFAULT_RULE_CONFIG, ...config };
    this.battleNo = battleNo;
  }

  /** 畫格間隔（秒），平手門檻的預設值 */
  get frameInterval(): number {
    return this.lastDt;
  }

  get drawTolerance(): number {
    return this.config.drawToleranceSec ?? this.lastDt;
  }

  /** 目前每顆陀螺的追蹤狀態（疊圖顯示用） */
  snapshot(): Record<BeyId, { zone: Zone; spinning: boolean | null; pending: Zone | null; suspectStop: boolean; visible: boolean }> {
    const out = {} as ReturnType<RefereeEngine["snapshot"]>;
    for (const id of BEYS) {
      const tr = this.tracks[id];
      out[id] = {
        zone: tr.zone,
        spinning: tr.spinning,
        pending: tr.pending?.zone ?? null,
        suspectStop: tr.stop !== null,
        visible: tr.visible,
      };
    }
    return out;
  }

  swapOwners() {
    this.owners = { A: this.owners.B, B: this.owners.A };
  }

  /** 手動「開始這一局」（開局觸發失效時的備援） */
  manualStart(t: number): EngineStep {
    this.beginLive(t, true);
    return { call: null, events: this.events.slice(-1) };
  }

  /** 回到待機（放棄本局，不產生判定） */
  reset(t: number) {
    this.state = "IDLE";
    this.call = null;
    this.events = [];
    this.liveAt = null;
    this.quietSince = null;
    this.twoSpinningSince = null;
    this.tracks = { A: newTrack("A", t), B: newTrack("B", t) };
  }

  /** 進入下一局（判定確認後呼叫） */
  nextBattle(t: number) {
    this.battleNo += 1;
    this.reset(t);
  }

  /**
   * 手動判定（爆裂終結按鈕、改判）。loserBey = 被判輸的那顆；null 代表平手／無法判定。
   */
  manualCall(result: FinishResult, loserBey: BeyId | null, t: number): BattleCall {
    const call = this.makeCall(result, loserBey, null, t, ["manual"], "high");
    this.finish(call, t);
    this.events.push({ t, kind: "manual", bey: loserBey ?? undefined, note: result });
    return call;
  }

  /** 餵入一格觀測 */
  update(obs: FrameObs): EngineStep {
    const t = obs.t;
    if (this.prevT !== null && t > this.prevT) {
      this.lastDt = t - this.prevT;
    }
    this.prevT = t;
    const before = this.events.length;
    let call: BattleCall | null = null;

    switch (this.state) {
      case "IDLE":
        if (obs.hand) {
          this.state = "ARMED";
          this.twoSpinningSince = null;
          this.events.push({ t, kind: "armed" });
        }
        break;
      case "ARMED":
        if (obs.hand) {
          this.twoSpinningSince = null;
        } else if (this.twoSpinningIn(obs)) {
          this.twoSpinningSince ??= t;
          if (t - this.twoSpinningSince >= this.config.liveConfirmSec) {
            this.beginLive(t, false);
          }
        } else {
          this.twoSpinningSince = null;
        }
        break;
      case "LIVE":
        call = this.stepLive(obs);
        break;
      case "CALLED":
        if (!obs.hand && !obs.beys.some((b) => b.visible && b.spinning === true)) {
          this.quietSince ??= t;
          if (t - this.quietSince >= this.config.idleClearSec) {
            this.nextBattle(t);
          }
        } else {
          this.quietSince = null;
        }
        break;
    }
    return { call, events: this.events.slice(before) };
  }

  private twoSpinningIn(obs: FrameObs): boolean {
    const inSpin = obs.beys.filter(
      (b) => b.visible && b.zone === "IN" && b.spinning === true
    );
    return inSpin.length >= 2;
  }

  private beginLive(t: number, manual: boolean) {
    this.state = "LIVE";
    this.liveAt = t;
    this.call = null;
    this.quietSince = null;
    this.twoSpinningSince = null;
    this.tracks = { A: newTrack("A", t), B: newTrack("B", t) };
    this.events.push({ t, kind: "live", note: manual ? "manual" : undefined });
  }

  private stepLive(obs: FrameObs): BattleCall | null {
    const t = obs.t;
    const c = this.config;

    // 1. 手進盤檢查：立即結束該局
    if (obs.hand) {
      this.events.push({ t, kind: "hand" });
      return this.callOnHand(t);
    }

    // 2–4. 更新每顆陀螺的區域、進區事件、復活
    const seen = new Map<BeyId, BeyObs>();
    for (const b of obs.beys) seen.set(b.id, b);

    for (const id of BEYS) {
      const tr = this.tracks[id];
      const ob = seen.get(id);
      if (tr.confirmed) continue; // 已成立的終結不再變動
      if (!ob || !ob.visible) {
        this.updateInvisible(tr, t);
        continue;
      }
      tr.visible = true;
      tr.lastSeenT = t;
      tr.spinning = ob.spinning;
      tr.zone = ob.zone;

      if (ob.zone === "OUT") {
        // 影像管線判定它從非口袋位置出鏡
        tr.outSince ??= t;
        continue;
      }
      tr.outSince = null;

      if (ob.zone === "XTREME" || ob.zone === "OVER") {
        tr.inSpinSince = null;
        if (!tr.pending) {
          tr.pending = { zone: ob.zone, tEnter: t, stop: null, vanishedAt: null };
          tr.stop = null;
          this.events.push({ t, kind: "enter", bey: id, zone: ob.zone });
        } else {
          tr.pending.vanishedAt = null;
          if (ob.zone === tr.pending.zone) {
            tr.pending.stop = this.observeStop(tr.pending.stop, ob.spinning, t);
          } else {
            // 跨到另一個區（極限區↔出界區）：以最先進入的區為準，停止計時重算
            tr.pending.stop = null;
          }
        }
        continue;
      }

      // ob.zone === "IN"
      if (tr.pending) {
        tr.pending.vanishedAt = null;
        tr.pending.stop = null;
        // 回到對戰區：復活（需兩顆旋轉中）或在對戰區停住（不算出界，走轉停）
        if (ob.spinning === false) tr.inSpinSince = null;
        else if (ob.spinning === true) tr.inSpinSince ??= t;
        tr.stop = this.observeStop(tr.stop, ob.spinning, t, id);
        if (tr.stop && tr.stop.validSec >= c.zoneStopConfirmSec) {
          this.cancelPending(tr, t, "stopped_in_arena");
        }
        continue;
      }

      // 6. 轉停：對戰區內自轉訊號低於門檻（只累計有效觀測）
      tr.stop = this.observeStop(tr.stop, ob.spinning, t, id);
    }

    // 復活：待確認的陀螺保持旋轉回到對戰區，且另一顆也在對戰區內（旋轉中或已停）
    // 連續 reverseConfirmSec 後取消待確認。兩顆都在轉就是規格 3.2 的「兩顆旋轉中」；
    // 另一顆已停時仍需能解除，否則轉停終結永遠等不到先後比較。
    for (const id of BEYS) {
      const tr = this.tracks[id];
      const o = this.tracks[other(id)];
      if (!tr.pending || tr.confirmed || tr.zone !== "IN" || !tr.visible) continue;
      if (tr.inSpinSince === null) continue;
      const otherInArena = o.visible && o.zone === "IN";
      if (otherInArena && t - tr.inSpinSince >= c.reverseConfirmSec) {
        this.cancelPending(tr, t, "reverse");
      }
    }

    // 5. 確認進區終結；6. 確認轉停；盤外
    for (const id of BEYS) {
      const tr = this.tracks[id];
      if (tr.confirmed) continue;
      const p = tr.pending;
      if (p) {
        let how: string | null = null;
        if (p.stop !== null && p.stop.validSec >= c.zoneStopConfirmSec) how = "stopped";
        else if (p.vanishedAt !== null && t - p.vanishedAt >= c.zoneVanishConfirmSec) how = "vanished";
        else if (
          (tr.zone === "XTREME" || tr.zone === "OVER") &&
          t - p.tEnter >= c.zoneStayConfirmSec
        )
          how = "stayed";
        if (how) {
          tr.confirmed = {
            bey: id,
            result: p.zone === "XTREME" ? "XTREME_FINISH" : "OVER_FINISH",
            tEvent: p.tEnter,
            resolved: true,
            how,
          };
          tr.pending = null;
          this.events.push({ t, kind: "finish_confirmed", bey: id, zone: p.zone, note: how });
        }
        continue;
      }
      if (tr.stop !== null && tr.stop.validSec >= c.spinStopConfirmSec) {
        tr.confirmed = {
          bey: id,
          result: "SPIN_FINISH",
          tEvent: tr.stop.since,
          resolved: true,
          how: "spin",
        };
        this.events.push({ t, kind: "finish_confirmed", bey: id, zone: "IN", note: "spin" });
        continue;
      }
      if (tr.outSince !== null && t - tr.outSince >= c.outOfFrameSec) {
        tr.confirmed = {
          bey: id,
          result: "NO_CALL",
          tEvent: tr.outSince,
          resolved: true,
          how: "out_of_frame",
        };
        this.events.push({ t, kind: "out_of_frame", bey: id });
      }
    }

    // 7–8. 先後比較與平手
    return this.resolve(t);
  }

  /**
   * 餵入一格的自轉觀測到停止計時：true 歸零、false 累計、null（看不到／量不到）只記 gap。
   * gap 超過 spinStopMaxGapFrames 整段歸零，之後重新開始算。
   */
  private observeStop(run: StopRun | null, spinning: boolean | null, t: number, bey?: BeyId): StopRun | null {
    if (spinning === true) {
      if (run && bey) this.events.push({ t, kind: "resume_spin", bey });
      return null;
    }
    if (spinning === false) {
      if (!run) {
        if (bey) this.events.push({ t, kind: "suspect_stop", bey });
        return { since: t, validSec: 0, gap: 0 };
      }
      return { since: run.since, validSec: run.validSec + this.lastDt, gap: 0 };
    }
    // 本格沒有有效觀測
    if (!run) return null;
    if (run.gap + 1 > this.config.spinStopMaxGapFrames) {
      if (bey) this.events.push({ t, kind: "stop_reset", bey, note: `gap>${this.config.spinStopMaxGapFrames}` });
      return null;
    }
    return { ...run, gap: run.gap + 1 };
  }

  private updateInvisible(tr: Track, t: number) {
    tr.visible = false;
    tr.spinning = null;
    // 看不到也是「沒有觀測」：停止計時只記 gap，不累計、也不立刻歸零
    tr.stop = this.observeStop(tr.stop, null, t, tr.id);
    if (tr.pending) {
      tr.pending.vanishedAt ??= t;
      tr.pending.stop = this.observeStop(tr.pending.stop, null, t);
      if (tr.pending.vanishedAt === t) {
        this.events.push({ t, kind: "disappear", bey: tr.id, zone: tr.pending.zone });
      }
    } else if (tr.zone === "IN" || tr.zone === "OUT") {
      // 從非口袋位置離開畫面
      if (tr.outSince === null) {
        tr.outSince = t;
        tr.zone = "OUT";
      }
    }
  }

  private cancelPending(tr: Track, t: number, why: string) {
    const z = tr.pending?.zone;
    tr.pending = null;
    tr.reverses += 1;
    this.events.push({ t, kind: "reverse", bey: tr.id, zone: z, note: why });
  }

  /** 收集兩顆陀螺的候選終結（已確認與待確認） */
  private candidates(): Candidate[] {
    const out: Candidate[] = [];
    for (const id of BEYS) {
      const tr = this.tracks[id];
      if (tr.confirmed) {
        out.push(tr.confirmed);
        continue;
      }
      if (tr.pending) {
        out.push({
          bey: id,
          result: tr.pending.zone === "XTREME" ? "XTREME_FINISH" : "OVER_FINISH",
          tEvent: tr.pending.tEnter,
          resolved: false,
        });
      } else if (tr.stop !== null) {
        out.push({ bey: id, result: "SPIN_FINISH", tEvent: tr.stop.since, resolved: false });
      } else if (tr.outSince !== null) {
        out.push({ bey: id, result: "NO_CALL", tEvent: tr.outSince, resolved: false });
      }
    }
    return out.sort((a, b) => a.tEvent - b.tEvent);
  }

  private resolve(t: number): BattleCall | null {
    const cands = this.candidates();
    const confirmed = cands.filter((x) => x.resolved);
    if (confirmed.length === 0) return null;
    const best = confirmed[0];
    const tol = this.drawTolerance;
    // 另一顆還有更早或同時的候選終結尚未確認：等它確認或取消，才能比先後
    const blocking = cands.find(
      (x) => !x.resolved && x.bey !== best.bey && x.tEvent <= best.tEvent + tol
    );
    if (blocking) return null;

    const flags = this.commonFlags();
    if (confirmed.length === 2 && Math.abs(confirmed[0].tEvent - confirmed[1].tEvent) <= tol) {
      if (confirmed.every((x) => x.result === "NO_CALL")) {
        return this.finish(this.makeCall("NO_CALL", null, best.tEvent, t, [...flags, "out_of_frame"], "low"), t);
      }
      return this.finish(
        this.makeCall("DRAW", null, best.tEvent, t, [...flags, "simultaneous"], "medium"),
        t
      );
    }
    if (best.result === "NO_CALL") {
      return this.finish(
        this.makeCall("NO_CALL", best.bey, best.tEvent, t, [...flags, "out_of_frame"], "low"),
        t
      );
    }
    if (best.how) flags.push(`confirm_${best.how}`);
    const confidence: Confidence =
      best.how === "vanished" || flags.some((f) => f.startsWith("reverse")) ? "medium" : "high";
    return this.finish(this.makeCall(best.result, best.bey, best.tEvent, t, flags, confidence), t);
  }

  /** 手進盤：若已有候選終結，以最早者判定並標記 hand_early；否則無法判定 */
  private callOnHand(t: number): BattleCall {
    const cands = this.candidates().filter((x) => x.result !== "NO_CALL");
    const flags = this.commonFlags();
    if (cands.length === 0) {
      return this.finish(
        this.makeCall("NO_CALL", null, null, t, [...flags, "hand_before_call"], "low"),
        t
      );
    }
    const best = cands[0];
    const tol = this.drawTolerance;
    if (cands.length === 2 && Math.abs(cands[0].tEvent - cands[1].tEvent) <= tol) {
      return this.finish(
        this.makeCall("DRAW", null, best.tEvent, t, [...flags, "simultaneous", "hand_early"], "low"),
        t
      );
    }
    if (!best.resolved) flags.push("hand_early");
    else if (best.how) flags.push(`confirm_${best.how}`);
    return this.finish(
      this.makeCall(best.result, best.bey, best.tEvent, t, flags, best.resolved ? "high" : "medium"),
      t
    );
  }

  private commonFlags(): string[] {
    const flags: string[] = [];
    const rev = this.tracks.A.reverses + this.tracks.B.reverses;
    if (rev > 0) flags.push(`reverse_x${rev}`);
    return flags;
  }

  private makeCall(
    result: FinishResult,
    loserBey: BeyId | null,
    tEvent: number | null,
    t: number,
    flags: string[],
    confidence: Confidence
  ): BattleCall {
    const scorable = result !== "DRAW" && result !== "NO_CALL";
    const winner: PlayerId | null = scorable && loserBey ? this.owners[other(loserBey)] : null;
    const points = scorable ? this.config.points[result] : 0;
    return {
      battle: this.battleNo,
      result,
      points,
      winner,
      t_event: tEvent,
      t_called: t,
      flags,
      confidence,
      loser_bey: loserBey,
    };
  }

  private finish(call: BattleCall, t: number): BattleCall {
    this.call = call;
    this.state = "CALLED";
    this.quietSince = null;
    this.events.push({ t, kind: "called", note: call.result });
    return call;
  }
}

/** 相對於 LIVE 開始的秒數（顯示用） */
export function sinceLive(engine: RefereeEngine, t: number | null): number | null {
  if (t === null || engine.liveAt === null) return null;
  return t - engine.liveAt;
}
