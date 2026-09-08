import Link from "next/link";
import { CLASS_LABEL, LadderClass } from "@/lib/ladder";
import { GymBoardRow, boardByClass } from "@/lib/gymStats";

/**
 * 館內排行榜。
 *
 * 依全平台積分排序——這個榜是給店家挑代表選手用的，代表要挑最強的；
 * 館內場次／勝場只當附加資訊。分通常組（小孩）／公開組（家長），
 * 因為店家選代表時這兩組本來就要分開看。
 */
export function GymLeaderboard({ board }: { board: GymBoardRow[] }) {
  const classes: LadderClass[] = ["normal", "open"];
  const shown = classes.filter((c) => boardByClass(board, c).length > 0);

  if (shown.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-arena-line p-6 text-center text-sm text-slate-500">
        這一季還沒有人在這裡打過。第一個來的就是榜首。
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {shown.map((cls) => (
        <section key={cls}>
          <h3 className="mb-2 text-sm font-bold text-slate-400">
            {CLASS_LABEL[cls]}
          </h3>
          <ol className="space-y-2">
            {boardByClass(board, cls).map((r, i) => (
              <li key={r.playerId}>
                <Link
                  href={`/player/${r.playerId}`}
                  className="flex items-center gap-3 rounded-xl border border-arena-line bg-arena px-3 py-2.5 transition active:scale-[0.99]"
                >
                  <span className="w-6 shrink-0 text-center font-num text-sm font-bold text-slate-500">
                    {i + 1}
                  </span>
                  <span className="text-xl">{r.avatar}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">
                      {r.nickname}
                    </span>
                    <span className={`block text-xs font-bold ${r.rankText}`}>
                      {r.rankIcon} {r.rankLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-num text-sm font-bold">
                      {r.rating}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      館內 {r.matches} 場 {r.wins} 勝
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
