import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrganizerForUser } from "@/lib/organizer";
import { NewEventForm } from "@/components/NewEventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const organizer = await getOrganizerForUser(supabaseAdmin(), session.uid);
  if (!organizer) redirect("/host");

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/host" className="text-sm text-slate-400 hover:text-slate-200">
        ← 我的賽事
      </Link>
      <h1 className="mt-4 text-2xl font-black">🏁 開一場新賽事</h1>
      <div className="mt-4 rounded-2xl border border-arena-line bg-arena-card p-5">
        <NewEventForm tierAllowed={organizer.tier_allowed} />
      </div>
    </main>
  );
}
