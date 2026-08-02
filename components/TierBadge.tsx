import { TIERS, Tier } from "@/lib/events";

/**
 * 金屬質感階層：金級最華麗（漸層＋光暈）＞ 銀級亮金屬 ＞ 銅級深銅沉穩。
 */
const TIER_CLASSES: Record<Tier, string> = {
  bronze:
    "border-[#8a5a2b]/70 bg-gradient-to-r from-[#3a2412]/80 to-[#241608]/80 text-[#c98d55]",
  silver:
    "border-slate-200/70 bg-gradient-to-r from-slate-300/25 via-slate-100/15 to-slate-500/15 text-slate-100",
  gold: "border-gold bg-gradient-to-r from-gold/35 via-amber-200/20 to-amber-600/20 text-gold shadow-glow-gold",
};

const TIER_MEDAL: Record<Tier, string> = {
  bronze: "🥉",
  silver: "🥈",
  gold: "🥇",
};

export function TierBadge({ tier }: { tier: Tier }) {
  const t = TIERS[tier];
  return (
    <span
      className={`inline-flex -skew-x-12 items-center gap-1.5 border px-2.5 py-0.5 text-xs font-black tracking-wider ${TIER_CLASSES[tier]}`}
    >
      {TIER_MEDAL[tier]} {t.label}
      <span className="font-medium opacity-70">{t.freq}</span>
    </span>
  );
}

export function StatusChip({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  const cls =
    status === "confirmed"
      ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
      : status === "open"
        ? "border-cyanx/50 bg-cyanx/10 text-cyanx"
        : "border-slate-500/50 bg-slate-500/10 text-slate-400";
  return (
    <span
      className={`inline-block -skew-x-12 border px-2.5 py-0.5 text-xs font-bold tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}
