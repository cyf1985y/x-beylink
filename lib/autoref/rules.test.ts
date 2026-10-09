/**
 * 規則引擎單元測試。
 *
 * 執行：npm test（node --test，Node 22 原生 TypeScript 型別剝除，不需要額外套件）
 *
 * 測試案例來自規格 5.1 的 12 局（以影片記分板為正確答案），用「理想的觀測序列」
 * 餵給引擎，驗證規則邏輯本身；影像管線的誤差不在此處測。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { RefereeEngine } from "./rules.ts";
import {
  addBattle,
  matchWinner,
  newMatch,
  overrideBattle,
  scoreOf,
  voidBattle,
} from "./match.ts";
import type { BattleCall, BeyId, BeyObs, FrameObs, Zone } from "./types.ts";

type BeySpec = { zone?: Zone; spinning?: boolean | null; visible?: boolean };
type Spec = { hand?: boolean; A?: BeySpec | null; B?: BeySpec | null };

/** 以固定幀率餵格的模擬器 */
class Sim {
  t = 0;
  readonly dt: number;
  calls: BattleCall[] = [];
  engine: RefereeEngine;
  constructor(engine: RefereeEngine, fps = 30) {
    this.engine = engine;
    this.dt = 1 / fps;
  }

  private obs(spec: Spec): FrameObs {
    const beys: BeyObs[] = [];
    for (const id of ["A", "B"] as BeyId[]) {
      const s = spec[id];
      if (s === null) continue;
      beys.push({
        id,
        visible: s?.visible ?? true,
        zone: s?.zone ?? "IN",
        spinning: s?.spinning === undefined ? true : s.spinning,
      });
    }
    return { t: this.t, hand: spec.hand ?? false, beys };
  }

  /** 餵 sec 秒的同樣畫面；回傳這段期間的第一個判定 */
  run(sec: number, spec: Spec = {}): BattleCall | null {
    const n = Math.round(sec / this.dt);
    let first: BattleCall | null = null;
    for (let i = 0; i < n; i++) {
      const r = this.engine.update(this.obs(spec));
      if (r.call) {
        this.calls.push(r.call);
        first ??= r.call;
      }
      this.t += this.dt;
    }
    return first;
  }

  /** 標準開局：空盤 → 手進來 → 手離開且兩顆旋轉 → LIVE */
  launch() {
    this.run(0.3, { A: null, B: null });
    this.run(0.3, { hand: true, A: null, B: null });
    this.run(0.5);
    assert.equal(this.engine.state, "LIVE");
    return this.t;
  }
}

function make(fps = 30) {
  const engine = new RefereeEngine();
  return new Sim(engine, fps);
}

const close = (a: number | null, b: number, tol = 0.04) => {
  assert.ok(a !== null && Math.abs(a - b) <= tol, `expected ${a} ≈ ${b}`);
};

describe("開局狀態機", () => {
  test("IDLE → ARMED → LIVE 需要手離開後 0.3 秒兩顆旋轉", () => {
    const s = make();
    s.run(0.2, { A: null, B: null });
    assert.equal(s.engine.state, "IDLE");
    s.run(0.2, { hand: true, A: null, B: null });
    assert.equal(s.engine.state, "ARMED");
    s.run(0.2);
    assert.equal(s.engine.state, "ARMED");
    s.run(0.15);
    assert.equal(s.engine.state, "LIVE");
  });

  test("手還在盤面上方時不會開局", () => {
    const s = make();
    s.run(0.2, { hand: true, A: null, B: null });
    s.run(1, { hand: true });
    assert.equal(s.engine.state, "ARMED");
  });

  test("手動開始這一局（開局觸發失效的備援）", () => {
    const s = make();
    s.run(0.2, { A: null, B: null });
    s.engine.manualStart(s.t);
    assert.equal(s.engine.state, "LIVE");
    assert.equal(s.engine.events.at(-1)?.note, "manual");
  });

  test("判定後盤內清空 0.5 秒回到 IDLE，局號 +1", () => {
    const s = make();
    s.launch();
    const call = s.run(1, { B: { zone: "OVER", spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.equal(s.engine.state, "CALLED");
    s.run(0.6, { A: null, B: null });
    assert.equal(s.engine.state, "IDLE");
    assert.equal(s.engine.battleNo, 2);
    s.run(0.3, { hand: true, A: null, B: null });
    s.run(0.5);
    assert.equal(s.engine.state, "LIVE");
  });

  test("判定後手進來撿陀螺／再發射：直接進入下一局 ARMED（連續對戰不會有清空空檔）", () => {
    const s = make();
    s.launch();
    const call = s.run(1, { B: { zone: "OVER", spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    s.run(0.3, { hand: true, A: { spinning: true }, B: null }); // 撿陀螺，A 還在轉
    assert.equal(s.engine.state, "ARMED");
    assert.equal(s.engine.battleNo, 2);
    s.run(0.5); // 手離開，兩顆旋轉
    assert.equal(s.engine.state, "LIVE");
  });

  test("開局不要求每格都量到旋轉：發射瞬間模糊（null）可接受，但量到停止就重算", () => {
    const s = make();
    s.run(0.2, { hand: true, A: null, B: null });
    s.run(0.2, { A: { spinning: null }, B: { spinning: true } });
    s.run(0.2, { A: { spinning: true }, B: { spinning: null } });
    assert.equal(s.engine.state, "LIVE", "兩顆都在盤內且各量到過一次旋轉");
    const s2 = make();
    s2.run(0.2, { hand: true, A: null, B: null });
    s2.run(1, { A: { spinning: null }, B: { spinning: null } });
    assert.equal(s2.engine.state, "ARMED", "從未量到旋轉不能開局");
    const s3 = make();
    s3.run(0.2, { hand: true, A: null, B: null });
    s3.run(1, { A: { spinning: true }, B: { spinning: false } });
    assert.equal(s3.engine.state, "ARMED", "一顆量到停止不能開局");
  });

  test("沒偵測到手也能備援開局：兩顆在盤內旋轉 0.6 秒", () => {
    const s = make();
    s.run(0.2, { A: null, B: null });
    s.run(0.5);
    assert.equal(s.engine.state, "IDLE");
    s.run(0.15);
    assert.equal(s.engine.state, "LIVE");
    assert.equal(s.engine.events.at(-1)?.note, "auto_no_hand");
  });
});

describe("規格 5.1 的 12 局（理想觀測）", () => {
  test("影片 1 局 1：轉停，陀螺倒下靜止，手 0.6 秒後才進盤", () => {
    const s = make();
    s.launch();
    const tStop = s.t;
    let call = s.run(0.6, { B: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    assert.equal(call?.winner, "P1");
    assert.equal(call?.points, 1);
    close(call!.t_event, tStop);
    assert.ok(!call!.flags.includes("hand_early"));
    call = s.run(0.2, { hand: true, B: { spinning: false } });
    assert.equal(call, null, "判定後不再接受新事件");
  });

  test("影片 2 局 7：極限終結 +3", () => {
    const s = make();
    s.launch();
    s.run(0.5);
    const tEnter = s.t;
    const call = s.run(1, { A: { zone: "XTREME", spinning: false } });
    assert.equal(call?.result, "XTREME_FINISH");
    assert.equal(call?.winner, "P2");
    assert.equal(call?.points, 3);
    close(call!.t_event, tEnter);
    assert.ok(call!.flags.includes("confirm_stopped"));
  });

  test("影片 2 局 8：場內轉停 +1（當時腳本未實作）", () => {
    const s = make();
    s.launch();
    s.run(2);
    const tStop = s.t;
    const call = s.run(0.5, { A: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    assert.equal(call?.winner, "P2");
    close(call!.t_event, tStop);
    close(call!.t_called, tStop + 0.15, 0.05);
  });

  test("影片 2 局 9：進極限區後仍旋轉約 1 秒，終結時間回推為進區時間", () => {
    const s = make();
    s.launch();
    const tEnter = s.t;
    let call = s.run(1, { B: { zone: "XTREME", spinning: true } });
    assert.equal(call, null, "仍在旋轉且未滿 3 秒，不應判定");
    call = s.run(0.5, { B: { zone: "XTREME", spinning: false } });
    assert.equal(call?.result, "XTREME_FINISH");
    assert.equal(call?.winner, "P1");
    close(call!.t_event, tEnter);
    assert.ok(call!.t_called - call!.t_event! > 1);
  });

  test("影片 2 局 10：出界終結 +2", () => {
    const s = make();
    s.launch();
    const call = s.run(1, { A: { zone: "OVER", spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.equal(call?.winner, "P2");
    assert.equal(call?.points, 2);
  });

  test("影片 3 局 1：出界終結", () => {
    const s = make();
    s.launch();
    const call = s.run(1, { B: { zone: "OVER", spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.equal(call?.winner, "P1");
  });

  test("影片 3 局 2：進左口袋後掉出畫面——消失是出界的證據，不是復活", () => {
    const s = make();
    s.launch();
    const tEnter = s.t;
    s.run(0.1, { B: { zone: "OVER", spinning: true } });
    let call = s.run(1, { B: { visible: false, zone: "OVER", spinning: null } });
    assert.equal(call, null, "消失 1 秒內還不確認");
    call = s.run(1, { B: { visible: false, zone: "OVER", spinning: null } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.equal(call?.winner, "P1");
    close(call!.t_event, tEnter);
    assert.ok(call!.flags.includes("confirm_vanished"));
    assert.equal(call!.confidence, "medium");
  });

  test("影片 3 局 3：停轉後仍在滾動，選手隨即伸手——以疑似停止判定並標記 hand_early", () => {
    const s = make();
    s.launch();
    const tStop = s.t;
    // 位移中但自轉為零（運動補償訊號給 spinning=false）
    let call = s.run(0.1, { A: { spinning: false } });
    assert.equal(call, null);
    call = s.run(0.1, { hand: true, A: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    assert.equal(call?.winner, "P2");
    assert.ok(call!.flags.includes("hand_early"));
    assert.equal(call!.confidence, "medium");
    close(call!.t_event, tStop);
  });

  test("影片 3 局 4：貼框彈跳不算進區，進區時間以整顆進入為準", () => {
    const s = make();
    s.launch();
    s.run(1.6); // 影像管線用重疊比例，貼框滾動期間仍回報 IN
    const tEnter = s.t;
    const call = s.run(1, { A: { zone: "OVER", spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    close(call!.t_event, tEnter);
  });

  test("影片 3 局 5：出界終結", () => {
    const s = make();
    s.launch();
    const call = s.run(3.2, { B: { zone: "OVER", spinning: true } });
    assert.equal(call?.result, "OVER_FINISH", "留在區內超過 3 秒即成立");
    assert.ok(call!.flags.includes("confirm_stayed"));
  });

  test("影片 3 局 6：停轉後滾動，0.2 秒後才伸手——已確認，不標 hand_early", () => {
    const s = make();
    s.launch();
    const call = s.run(0.2, { B: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    assert.equal(call?.winner, "P1");
    assert.ok(!call!.flags.includes("hand_early"));
    assert.equal(s.run(0.1, { hand: true, B: { spinning: false } }), null);
  });

  test("影片 3 局 7：開局被遮擋時手動開始，陀螺停在右口袋判出界", () => {
    const s = make();
    s.run(0.3, { A: null, B: null });
    s.engine.manualStart(s.t);
    s.run(0.5);
    const call = s.run(1, { A: { zone: "OVER", spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.equal(call?.winner, "P2");
  });
});

describe("復活、先後、平手、盤外", () => {
  test("復活：進極限區又旋轉回到對戰區，終結取消並記 reverse", () => {
    const s = make();
    s.launch();
    let call = s.run(0.2, { A: { zone: "XTREME", spinning: true } });
    assert.equal(call, null);
    call = s.run(0.5);
    assert.equal(call, null, "回到對戰區且兩顆旋轉 → 復活");
    assert.ok(s.engine.events.some((e) => e.kind === "reverse" && e.bey === "A"));
    call = s.run(1, { B: { zone: "OVER", spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.equal(call?.winner, "P1");
    assert.ok(call!.flags.includes("reverse_x1"));
  });

  test("進區後回到對戰區但停住：不算出界，走轉停", () => {
    const s = make();
    s.launch();
    s.run(0.2, { A: { zone: "OVER", spinning: true } });
    const tStop = s.t;
    const call = s.run(1, { A: { zone: "IN", spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    assert.equal(call?.winner, "P2");
    close(call!.t_event, tStop);
  });

  test("先後比較：較早進區但較晚確認的終結仍然勝出", () => {
    const s = make();
    s.launch();
    const tEnter = s.t;
    s.run(0.2, { A: { zone: "OVER", spinning: true } });
    // B 在對戰區停轉，0.15 秒後會先確認；但 A 的進區時間更早，必須等 A 確認
    let call = s.run(0.4, { A: { zone: "OVER", spinning: true }, B: { spinning: false } });
    assert.equal(call, null, "A 尚未確認前不能判 B 的轉停");
    call = s.run(0.5, { A: { zone: "OVER", spinning: false }, B: { spinning: false } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.equal(call?.winner, "P2");
    close(call!.t_event, tEnter);
  });

  test("先後比較：較早的候選若復活，較晚的轉停成立", () => {
    const s = make();
    s.launch();
    s.run(0.2, { A: { zone: "OVER", spinning: true } });
    const tStop = s.t;
    s.run(0.05, { A: { zone: "OVER", spinning: true }, B: { spinning: false } });
    // A 保持旋轉回到對戰區（B 已停）：A 的出界取消，B 的轉停成立
    const call = s.run(0.5, { A: { zone: "IN", spinning: true }, B: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    assert.equal(call?.winner, "P1");
    close(call!.t_event, tStop);
    assert.ok(call!.flags.includes("reverse_x1"));
    assert.ok(call!.t_called - tStop < 0.5, "不應等到 3 秒");
  });

  test("平手：兩顆同一格進入出界區", () => {
    const s = make();
    s.launch();
    const call = s.run(1, {
      A: { zone: "OVER", spinning: false },
      B: { zone: "OVER", spinning: false },
    });
    assert.equal(call?.result, "DRAW");
    assert.equal(call?.winner, null);
    assert.equal(call?.points, 0);
  });

  test("平手門檻可設定：相差 0.1 秒在預設下不是平手，放寬到 0.2 秒則是", () => {
    const strict = make();
    strict.launch();
    strict.run(0.1, { A: { zone: "OVER", spinning: false } });
    let call = strict.run(1, {
      A: { zone: "OVER", spinning: false },
      B: { zone: "XTREME", spinning: false },
    });
    assert.equal(call?.result, "OVER_FINISH");

    const loose = new Sim(new RefereeEngine({ drawToleranceSec: 0.2 }));
    loose.launch();
    loose.run(0.1, { A: { zone: "OVER", spinning: false } });
    call = loose.run(1, {
      A: { zone: "OVER", spinning: false },
      B: { zone: "XTREME", spinning: false },
    });
    assert.equal(call?.result, "DRAW");
  });

  test("盤外：從非口袋位置出鏡 1.5 秒未回 → 無法判定", () => {
    const s = make();
    s.launch();
    let call = s.run(1, { A: { visible: false, zone: "IN", spinning: null } });
    assert.equal(call, null);
    call = s.run(1, { A: { visible: false, zone: "IN", spinning: null } });
    assert.equal(call?.result, "NO_CALL");
    assert.ok(call!.flags.includes("out_of_frame"));
  });

  test("手在任何判定前進入 → 無法判定，交人工裁決", () => {
    const s = make();
    s.launch();
    const call = s.run(0.1, { hand: true });
    assert.equal(call?.result, "NO_CALL");
    assert.ok(call!.flags.includes("hand_before_call"));
    assert.equal(call!.confidence, "low");
  });

  test("手進盤時已有進區待確認 → 以該終結判定並標 hand_early", () => {
    const s = make();
    s.launch();
    const tEnter = s.t;
    s.run(0.1, { B: { zone: "XTREME", spinning: true } });
    const call = s.run(0.1, { hand: true, B: { zone: "XTREME", spinning: true } });
    assert.equal(call?.result, "XTREME_FINISH");
    assert.equal(call?.winner, "P1");
    assert.ok(call!.flags.includes("hand_early"));
    close(call!.t_event, tEnter);
  });

  test("手進盤時只存在一兩格的進區／疑似停止不算候選（剪接、閃爍防護）", () => {
    const s = make(30);
    s.launch();
    s.run(1 / 30, { B: { zone: "OVER", spinning: true } });
    let call = s.run(1 / 30, { hand: true, B: { zone: "OVER", spinning: true } });
    assert.equal(call?.result, "NO_CALL");
    assert.ok(call!.flags.includes("hand_before_call"));

    const s2 = make(30);
    s2.launch();
    s2.run(4 / 30, { B: { zone: "OVER", spinning: true } }); // 0.13 秒 ≥ 0.1
    call = s2.run(1 / 30, { hand: true, B: { zone: "OVER", spinning: true } });
    assert.equal(call?.result, "OVER_FINISH");
    assert.ok(call!.flags.includes("hand_early"));
  });

  test("手偵測到的那格起不再接受新的陀螺事件", () => {
    const s = make();
    s.launch();
    s.run(0.1, { hand: true });
    const n = s.engine.events.length;
    s.run(0.5, { A: { zone: "OVER", spinning: false } });
    assert.equal(s.engine.events.length, n);
  });
});

describe("得分歸屬與手動操作", () => {
  test("對調選手後得分歸屬跟著換", () => {
    const s = make();
    s.launch();
    s.engine.swapOwners();
    const call = s.run(1, { A: { zone: "OVER", spinning: false } });
    assert.equal(call?.winner, "P1");
  });

  test("手動爆裂終結", () => {
    const s = make();
    s.launch();
    s.run(0.5);
    const call = s.engine.manualCall("BURST_FINISH", "B", s.t);
    assert.equal(call.result, "BURST_FINISH");
    assert.equal(call.points, 2);
    assert.equal(call.winner, "P1");
    assert.ok(call.flags.includes("manual"));
    assert.equal(s.engine.state, "CALLED");
  });

  test("分數表與勝利分數可設定", () => {
    const s = new Sim(
      new RefereeEngine({ points: { XTREME_FINISH: 5, OVER_FINISH: 2, BURST_FINISH: 2, SPIN_FINISH: 1 } })
    );
    s.launch();
    const call = s.run(1, { A: { zone: "XTREME", spinning: false } });
    assert.equal(call?.points, 5);
  });

  test("60 fps 下預設平手門檻縮為一格", () => {
    const s = make(60);
    s.launch();
    close(s.engine.drawTolerance, 1 / 60, 0.001);
  });
});

describe("比分", () => {
  const call = (battle: number, result: BattleCall["result"], winner: BattleCall["winner"], points: number): BattleCall => ({
    battle,
    result,
    points,
    winner,
    t_event: 1,
    t_called: 2,
    flags: [],
    confidence: "high",
  });

  test("先得 4 分獲勝", () => {
    let m = newMatch(4);
    m = addBattle(m, call(1, "OVER_FINISH", "P1", 2));
    m = addBattle(m, call(2, "SPIN_FINISH", "P2", 1));
    assert.deepEqual(scoreOf(m), { P1: 2, P2: 1 });
    assert.equal(matchWinner(m), null);
    m = addBattle(m, call(3, "DRAW", null, 0));
    m = addBattle(m, call(4, "OVER_FINISH", "P1", 2));
    assert.deepEqual(scoreOf(m), { P1: 4, P2: 1 });
    assert.equal(matchWinner(m), "P1");
  });

  test("改判與重賽不計分，原始判定保留", () => {
    let m = newMatch(4);
    m = addBattle(m, call(1, "OVER_FINISH", "P1", 2));
    m = overrideBattle(m, 0, call(1, "XTREME_FINISH", "P2", 3));
    assert.deepEqual(scoreOf(m), { P1: 0, P2: 3 });
    assert.equal(m.battles[0].auto.result, "OVER_FINISH");
    m = voidBattle(m, 0);
    assert.deepEqual(scoreOf(m), { P1: 0, P2: 0 });
  });
});

describe("停轉確認只算有效觀測（實測誤判的根因）", () => {
  test("停止後看不到 7 格：計時歸零，不得在 0.15 秒確認", () => {
    const s = make(60);
    s.launch();
    let call = s.run(3 / 60, { A: { spinning: false } }); // 3 格有效停止
    assert.equal(call, null);
    call = s.run(7 / 60, { A: { visible: false, zone: "IN", spinning: null } });
    assert.equal(call, null);
    assert.ok(s.engine.events.some((e) => e.kind === "stop_reset" && e.bey === "A"));
    call = s.run(6 / 60, { A: { spinning: false } }); // 重新開始，只有 6 格
    assert.equal(call, null, "歸零後重算，有效觀測不足不能確認");
    call = s.run(6 / 60, { A: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    close(call!.t_event, s.t - 12 / 60, 0.02);
  });

  test("量不到（null）的格不累計也不立即歸零：2 格以內的中斷可以接續", () => {
    const s = make(60);
    s.launch();
    const tStop = s.t;
    s.run(4 / 60, { B: { spinning: false } });
    s.run(2 / 60, { B: { spinning: null } }); // 黏合或 peak 太低
    let call = s.run(4 / 60, { B: { spinning: false } }); // 有效 1+3+... 共 8 格 → 7 個 dt
    assert.equal(call, null);
    call = s.run(3 / 60, { B: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    close(call!.t_event, tStop, 0.02);
  });

  test("只有 null 沒有任何 false 觀測，永遠不會判轉停", () => {
    const s = make(60);
    s.launch();
    const call = s.run(2, { A: { spinning: null }, B: { spinning: null } });
    assert.equal(call, null);
  });

  test("手提前進入時，疑似停止（≥ handEarlyMinCandidateSec）仍可作為候選（hand_early）", () => {
    const s = make(60);
    s.launch();
    s.run(8 / 60, { B: { spinning: false } });
    const call = s.run(1 / 60, { hand: true, B: { spinning: false } });
    assert.equal(call?.result, "SPIN_FINISH");
    assert.ok(call!.flags.includes("hand_early"));
  });
});

/**
 * 用 docs/autoref/baseline/traces 的實測觀測序列重播規則引擎。
 * 觀測值是舊版影像管線的輸出（含沿用的 spinning=false），這裡只驗證引擎對「觀測中斷」的處理。
 */
function loadTrace(name: string, from: number, to: number): FrameObs[] {
  const path = fileURLToPath(new URL(`../../docs/autoref/baseline/traces/${name}.jsonl.gz`, import.meta.url));
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  const out: FrameObs[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { t: number; obs: FrameObs };
    if (r.t >= from && r.t <= to) out.push(r.obs);
  }
  return out;
}

describe("實測影片觀測序列重播（docs/autoref/baseline）", () => {
  test("18:46 段：A 停止後失去追蹤 7 格，原版在 1126.717 判 A 輸；修正後不得在 1127 前判 A", () => {
    const obs = loadTrace("return_local_60fps", 1126.5, 1128.0);
    assert.ok(obs.length > 60);
    const engine = new RefereeEngine();
    engine.manualStart(1126.5);
    const calls: BattleCall[] = [];
    for (const o of obs) {
      const r = engine.update(o);
      if (r.call) calls.push(r.call);
    }
    assert.ok(!calls.some((c) => c.loser_bey === "A" && c.t_called < 1127.0), JSON.stringify(calls));
    assert.ok(engine.events.some((e) => e.kind === "stop_reset" && e.bey === "A"));
  });

  test("21:24 段：B 的 0.15 秒確認窗內只有 3 格有效觀測，原版在 1284.917 判 B 輸；修正後不得在 1285 前判定", () => {
    const obs = loadTrace("contact_local_60fps", 1284.5, 1286.0);
    assert.ok(obs.length > 60);
    const engine = new RefereeEngine();
    engine.manualStart(1284.5);
    const calls: BattleCall[] = [];
    for (const o of obs) {
      const r = engine.update(o);
      if (r.call) calls.push(r.call);
    }
    assert.ok(!calls.some((c) => c.t_called < 1285.0), JSON.stringify(calls));
  });
});
