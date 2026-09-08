import { EarnedBadge } from "@/lib/gymStats";

/**
 * 選手卡上的徽章櫃。
 *
 * 同一種徽章每間道館各算一次，所以這裡刻意標出道館名稱——跨店蒐集的重點
 * 就是看得出「我在幾間店拿過」。
 */
export function BadgeShelf({ badges }: { badges: EarnedBadge[] }) {
  if (badges.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-arena-line p-5 text-center text-sm text-slate-500">
        還沒有徽章。到合作道館打幾場就能收集第一枚。
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-2">
      {badges.map((b) => (
        <li
          key={`${b.kind}:${b.gymId ?? "-"}`}
          className="rounded-xl border border-gold/40 bg-gold/5 px-3 py-2.5"
          title={b.desc}
        >
          <p className="text-2xl leading-none">{b.icon}</p>
          <p className="mt-1.5 text-sm font-bold text-gold">{b.label}</p>
          {b.gymName && (
            <p className="truncate text-[11px] text-slate-400">{b.gymName}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
