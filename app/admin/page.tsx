import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin, DbUser } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { DbOrganizer, DbOrganizerApplication } from "@/lib/organizer";
import { Tier, TIERS, formatTaipei } from "@/lib/events";
import {
  CreateOrganizerForm,
  EditOrganizerForm,
  ApplicationCard,
} from "@/components/AdminPanels";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!(await isAdmin(session))) notFound();

  const db = supabaseAdmin();
  const [
    { data: users },
    { data: organizers },
    { data: pending },
    { count: playerCount },
    { count: eventCount },
  ] = await Promise.all([
    db
      .from("users")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<DbUser[]>(),
    db.from("organizers").select("*").returns<DbOrganizer[]>(),
    db
      .from("organizer_applications")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .returns<DbOrganizerApplication[]>(),
    db.from("players").select("id", { count: "exact", head: true }),
    db.from("events").select("id", { count: "exact", head: true }),
  ]);

  const orgByUser = new Map((organizers ?? []).map((o) => [o.user_id, o]));
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const pendingApps = pending ?? [];

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
          ← 首頁
        </Link>
        <span className="rounded-full border border-violetx/50 bg-violetx/10 px-2.5 py-0.5 text-xs text-violetx">
          平台管理
        </span>
      </header>

      <h1 className="mt-4 text-2xl font-black">🛠 平台管理</h1>
      <p className="mt-1 text-xs text-slate-500">
        帳號 {(users ?? []).length}｜選手 {playerCount ?? 0}｜主辦方{" "}
        {(organizers ?? []).length}｜賽事 {eventCount ?? 0}
      </p>

      {pendingApps.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="font-bold text-gold">
            📮 待審主辦方申請（{pendingApps.length}）
          </h2>
          {pendingApps.map((a) => (
            <ApplicationCard
              key={a.id}
              applicationId={a.id}
              shopName={a.shop_name}
              contact={a.contact}
              note={a.note}
              displayName={
                userById.get(a.user_id)?.display_name ?? "（未命名帳號）"
              }
              appliedAt={formatTaipei(a.created_at)}
            />
          ))}
        </section>
      )}

      <section className="mt-6 space-y-3">
        <h2 className="font-bold text-slate-200">帳號與主辦方</h2>
        {(users ?? []).map((u) => {
          const org = orgByUser.get(u.id);
          return (
            <div
              key={u.id}
              className="rounded-2xl border border-arena-line bg-arena-card p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate font-bold">
                  {u.display_name ?? "（未命名）"}
                </p>
                {org ? (
                  <span className="text-xs text-cyanx">
                    🏟 {org.name}
                    {org.verified && " ✓"}｜{TIERS[org.tier_allowed as Tier].label}
                    ｜{org.events_held} 場｜{org.score} 分
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">一般帳號</span>
                )}
              </div>
              {org ? (
                <EditOrganizerForm
                  organizerId={org.id}
                  verified={org.verified}
                  tierAllowed={org.tier_allowed as Tier}
                  score={org.score}
                />
              ) : (
                <CreateOrganizerForm
                  userId={u.id}
                  displayName={u.display_name ?? "店家"}
                />
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
