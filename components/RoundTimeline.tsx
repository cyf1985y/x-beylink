import {
  finishMeta,
  isFinishType,
  reshootLabel,
} from "@/lib/bracket";
import type { DbMatchPoint } from "@/lib/rounds";

type P = { nickname: string; avatar: string } | null;

/**
 * 回合時間軸：match_points 按 created_at 排出來的逐回合紀錄。
 *
 * 舊資料（finish_type 為 null 的歷史列）只顯示「＋N」，不會炸。
 * 復原是實際刪掉那一列，所以時間軸自然會跟著少一筆。
 */
export function RoundTimeline({
  rows,
  player1,
  player2,
  className = "",
}: {
  rows: DbMatchPoint[];
  player1: P;
  player2: P;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className={className}>
        <h2 className="h-x">回合紀錄</h2>
        <p className="mt-3 rounded-2xl border border-dashed border-arena-line p-5 text-center text-sm text-slate-500">
          還沒有回合紀錄——按下計分或重射後會逐回合列在這裡。
        </p>
      </div>
    );
  }

  // 犯規扣分不是一個回合，不佔回合編號（但保留在時間順序上）
  let roundNo = 0;

  return (
    <div className={className}>
      <h2 className="h-x">回合紀錄</h2>
      <ol className="mt-3 space-y-1.5">
        {rows.map((r) => {
          const isReshoot = r.side === 0 || !!r.reshoot_reason;
          const isPenalty = !isReshoot && r.points < 0;
          if (!isPenalty) roundNo += 1;
          const no = isPenalty ? null : roundNo;

          const p = r.side === 1 ? player1 : r.side === 2 ? player2 : null;
          const sideText =
            r.side === 1 ? "text-cyanx" : r.side === 2 ? "text-red-300" : "";
          const sideDot = r.side === 1 ? "🔵" : r.side === 2 ? "🔴" : "";

          return (
            <li
              key={r.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                isReshoot
                  ? "border-arena-line bg-arena/60 text-slate-400"
                  : "border-arena-line bg-arena-card"
              }`}
            >
              <span className="w-14 shrink-0 font-num text-xs text-slate-500">
                {no === null ? "－" : `回合 ${no}`}
              </span>

              {isReshoot ? (
                <span className="min-w-0 flex-1 truncate">
                  ↻ 重射（{reshootLabel(r.reshoot_reason)}）
                </span>
              ) : (
                <>
                  <span className={`min-w-0 flex-1 truncate ${sideText}`}>
                    {sideDot} {p?.avatar ?? ""}{" "}
                    <b className="font-bold">{p?.nickname ?? "選手"}</b>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {isPenalty
                      ? "犯規"
                      : isFinishType(r.finish_type)
                        ? `${finishMeta(r.finish_type).icon} ${finishMeta(r.finish_type).label}`
                        : ""}
                  </span>
                  <span
                    className={`w-10 shrink-0 text-right font-num font-bold ${
                      isPenalty ? "text-red-300" : "text-slate-100"
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
    </div>
  );
}
