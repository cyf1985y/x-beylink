"use client";

import { finishOption, reshootLabel, type RoundEntry } from "@/lib/finish";

type P = { nickname: string; avatar: string } | null;

/**
 * 逐回合時間軸（賽事對戰頁與天梯對戰頁共用）。
 *
 * 資料就是 match_points 按 created_at 排；復原＝最後一列消失，所以時間軸永遠
 * 與實際按鍵順序一致，賽後 10 分鐘申訴有逐回合依據。
 * 舊資料（finish_type 為 null）退回只顯示「＋N」，不會炸。
 */
export function RoundTimeline({
  rounds,
  player1,
  player2,
}: {
  rounds: RoundEntry[];
  player1: P;
  player2: P;
}) {
  return (
    <section className="card-x p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-black tracking-wider text-slate-300">
          回合紀錄
        </h3>
        <span className="text-[11px] text-slate-500">
          共 {rounds.length} 回合
        </span>
      </div>

      {rounds.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-arena-line p-4 text-center text-xs text-slate-500">
          還沒有任何回合紀錄——按下計分或重射就會出現在這裡。
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {rounds.map((r, i) => {
            const who = r.side === 1 ? player1 : player2;
            const fin = finishOption(r.finishType);
            const isReshoot = !!r.reshootReason;
            const isFoul = !isReshoot && r.points < 0;

            return (
              <li
                key={r.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                  isReshoot
                    ? "border-arena-line bg-arena/60 text-slate-400"
                    : r.side === 1
                      ? "border-cyanx/30 bg-cyanx/5"
                      : "border-red-400/30 bg-red-500/5"
                }`}
              >
                <span className="w-14 shrink-0 font-num text-[11px] text-slate-500">
                  回合 {i + 1}
                </span>

                {isReshoot ? (
                  <span className="flex-1 truncate">
                    ↻ 重射（{reshootLabel(r.reshootReason)}）
                  </span>
                ) : (
                  <>
                    <span className="shrink-0">
                      {r.side === 1 ? "🔵" : "🔴"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-bold">
                      {who?.nickname ?? (r.side === 1 ? "藍方" : "紅方")}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {isFoul
                        ? "犯規扣分"
                        : fin
                          ? `${fin.emoji} ${fin.label}`
                          : "得分"}
                    </span>
                    <span
                      className={`w-10 shrink-0 text-right font-num font-bold ${
                        isFoul ? "text-red-300" : "text-slate-100"
                      }`}
                    >
                      {r.points > 0 ? `+${r.points}` : r.points}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
