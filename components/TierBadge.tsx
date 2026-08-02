import { TIERS, Tier } from "@/lib/events";

const TIER_CLASSES: Record<Tier, string> = {
  bronze: "border-bronze/60 bg-bronze/10 text-bronze",
  silver: "border-silver/60 bg-silver/10 text-silver",
  gold: "border-gold/60 bg-gold/10 text-gold",
};

export function TierBadge({ tier }: { tier: Tier }) {
  const t = TIERS[tier];
  return (
    <span
      className={`inline-flex -skew-x-12 items-center gap-1.5 border px-2.5 py-0.5 text-xs font-black tracking-wider ${TIER_CLASSES[tier]}`}
    >
      {t.label}
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
