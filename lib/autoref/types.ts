/**
 * 自動裁判（autoref）共用型別。
 *
 * 影像管線（vision/）每格輸出一筆 FrameObs，規則引擎（rules.ts）吃 FrameObs
 * 產生 BattleCall。兩邊只透過這些型別溝通，規則引擎不碰 DOM 與相機。
 */

/** 陀螺所在區域：對戰區／極限區／出界區／盤外（離開畫面且非口袋） */
export type Zone = "IN" | "XTREME" | "OVER" | "OUT";

/** 盤內兩顆陀螺的追蹤身分 */
export type BeyId = "A" | "B";

/** 選手代號 */
export type PlayerId = "P1" | "P2";

/** 終結方式 */
export type FinishResult =
  | "XTREME_FINISH"
  | "OVER_FINISH"
  | "SPIN_FINISH"
  | "BURST_FINISH"
  | "DRAW"
  | "NO_CALL";

/** 每格每顆陀螺的觀測值 */
export interface BeyObs {
  id: BeyId;
  /** 本格是否有在畫面上看到 */
  visible: boolean;
  /** 本格所在區域；看不到時沿用上一格的值 */
  zone: Zone;
  /**
   * 是否仍在自轉。影像管線已做過遲滯處理；null 代表本格量不到（例如剛黏合分開）。
   */
  spinning: boolean | null;
  /** 質心（盤面裁切座標），除錯與回放疊圖用 */
  x?: number;
  y?: number;
}

/** 每格觀測 */
export interface FrameObs {
  /** 畫格時間（秒，從開啟相機起算，單調遞增） */
  t: number;
  /** 盤面上方是否有手或發射器 */
  hand: boolean;
  beys: BeyObs[];
}

/** 局內事件（時間軸用） */
export interface BattleEvent {
  t: number;
  kind:
    | "armed"
    | "live"
    | "enter"
    | "reverse"
    | "disappear"
    | "suspect_stop"
    | "resume_spin"
    | "finish_confirmed"
    | "hand"
    | "out_of_frame"
    | "called"
    | "manual"
    | "stop_reset";
  bey?: BeyId;
  zone?: Zone;
  note?: string;
}

/** 判定信心 */
export type Confidence = "high" | "medium" | "low";

/** 一局的判定結果（規格 3.4） */
export interface BattleCall {
  battle: number;
  result: FinishResult;
  points: number;
  winner: PlayerId | null;
  /** 終結發生的時間（進區／停轉的瞬間） */
  t_event: number | null;
  /** 程式產生判定的時間 */
  t_called: number;
  flags: string[];
  confidence: Confidence;
  /** 被判輸的那顆陀螺（手動覆寫時可能為 null） */
  loser_bey?: BeyId | null;
}

/** 局的狀態 */
export type BattleState = "IDLE" | "ARMED" | "LIVE" | "CALLED";

/** 規則引擎的可調參數（規格 3.1、3.2、2.1；設定頁可改） */
export interface RuleConfig {
  /** IDLE 所需：連續無手、無旋轉陀螺的秒數 */
  idleClearSec: number;
  /** ARMED → LIVE：手離開後連續看到兩顆旋轉陀螺的秒數 */
  liveConfirmSec: number;
  /** 復活：回到對戰區後兩顆旋轉陀螺連續出現的秒數 */
  reverseConfirmSec: number;
  /** 進區終結確認：在區內停止旋轉達此秒數 */
  zoneStopConfirmSec: number;
  /** 進區終結確認：進區後消失且此秒數內無復活 */
  zoneVanishConfirmSec: number;
  /** 進區終結確認：留在區內超過此秒數 */
  zoneStayConfirmSec: number;
  /** 轉停：有效的「停止」觀測累計達此秒數才確認（看不到、量不到的格不計入） */
  spinStopConfirmSec: number;
  /** 停止計時中，連續幾格沒有有效觀測（看不到、黏合、量不到）就歸零重來 */
  spinStopMaxGapFrames: number;
  /** 盤外：從非口袋位置離開畫面且此秒數未回 */
  outOfFrameSec: number;
  /** 平手門檻（秒）；null = 一個畫格間隔 */
  drawToleranceSec: number | null;
  /** 分數表 */
  points: Record<
    "XTREME_FINISH" | "OVER_FINISH" | "BURST_FINISH" | "SPIN_FINISH",
    number
  >;
  /** 先得幾分獲勝 */
  winScore: number;
  /** 待機時沒偵測到手、但兩顆陀螺已在盤內旋轉（連續 liveConfirmSec 的兩倍）就自動開局 */
  autoStartWithoutHand: boolean;
  /**
   * 手提前進入時，未確認的候選（進區待確認、疑似停止）至少要存在此秒數才可拿來判定；
   * 只看到一兩格的進區或停止不算證據，否則剪接、閃爍都會變成終結。
   */
  handEarlyMinCandidateSec: number;
}

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  idleClearSec: 0.5,
  liveConfirmSec: 0.3,
  reverseConfirmSec: 0.1,
  zoneStopConfirmSec: 0.3,
  zoneVanishConfirmSec: 1.5,
  zoneStayConfirmSec: 3,
  spinStopConfirmSec: 0.15,
  spinStopMaxGapFrames: 2,
  autoStartWithoutHand: true,
  handEarlyMinCandidateSec: 0.1,
  outOfFrameSec: 1.5,
  drawToleranceSec: null,
  points: { XTREME_FINISH: 3, OVER_FINISH: 2, BURST_FINISH: 2, SPIN_FINISH: 1 },
  winScore: 4,
};

/** 終結方式的中文名稱 */
export const FINISH_LABEL: Record<FinishResult, string> = {
  XTREME_FINISH: "極限終結",
  OVER_FINISH: "出界終結",
  SPIN_FINISH: "轉停終結",
  BURST_FINISH: "爆裂終結",
  DRAW: "平手重賽",
  NO_CALL: "無法判定",
};
