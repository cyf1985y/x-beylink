import Link from "next/link";

/** 主辦方／裁判的底部導航（比賽當天四大動作） */
export function HostTabBar({
  eventId,
  active,
  isOwner = true,
}: {
  eventId: string;
  active: "manage" | "checkin" | "referee" | "settle";
  isOwner?: boolean;
}) {
  const tabs = [
    {
      key: "manage" as const,
      href: `/host/event/${eventId}`,
      icon: "📋",
      label: "賽事管理",
      ownerOnly: true,
    },
    {
      key: "checkin" as const,
      href: `/host/event/${eventId}#checkin`,
      icon: "📷",
      label: "掃碼報到",
      ownerOnly: true,
    },
    {
      key: "referee" as const,
      href: `/referee/event/${eventId}`,
      icon: "⚖️",
      label: "裁判模式",
      ownerOnly: false,
    },
    {
      key: "settle" as const,
      href: `/host/event/${eventId}/bracket`,
      icon: "🏆",
      label: "結算發獎",
      ownerOnly: true,
    },
  ].filter((t) => isOwner || !t.ownerOnly);

  return (
    <>
      <div className="h-20" />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-arena-line bg-arena-deep/95">
        <div className="mx-auto flex max-w-3xl">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] transition ${
                active === t.key
                  ? "text-cyanx"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className="text-lg">{t.icon}</span>
              <span className="font-bold">{t.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
