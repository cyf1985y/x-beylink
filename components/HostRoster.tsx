"use client";

import { useState, useTransition } from "react";
import {
  checkinByRegistrationId,
  type CheckinResult,
} from "@/app/host/actions";
import { formatTaipei } from "@/lib/events";

export type RosterRow = {
  regId: string;
  nickname: string;
  avatar: string;
  status: "ok" | "waitlist";
  checkedInAt: string | null;
};

function Row({ eventId, row }: { eventId: string; row: RosterRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const manualCheckin = () => {
    setError(null);
    startTransition(async () => {
      const result: CheckinResult = await checkinByRegistrationId(
        eventId,
        row.regId
      );
      if (!result.ok) setError(result.error ?? "報到失敗");
    });
  };

  return (
    <div className="rounded-xl border border-arena-line bg-arena p-3">
      <div className="flex items-center gap-3">
        <span className="text-xl">{row.avatar}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{row.nickname}</p>
          {row.status === "waitlist" ? (
            <p className="text-xs text-gold">⏳ 候補中</p>
          ) : row.checkedInAt ? (
            <p className="text-xs text-emerald-300">
              ✅ 已報到 {formatTaipei(row.checkedInAt)}
            </p>
          ) : (
            <p className="text-xs text-slate-500">未報到</p>
          )}
        </div>
        {row.status === "ok" && !row.checkedInAt && (
          <button
            onClick={manualCheckin}
            disabled={pending}
            className="rounded-lg border border-arena-line px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyanx hover:text-cyanx disabled:opacity-50"
          >
            {pending ? "…" : "手動報到"}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function HostRoster({
  eventId,
  rows,
}: {
  eventId: string;
  rows: RosterRow[];
}) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Row key={r.regId} eventId={eventId} row={r} />
      ))}
    </div>
  );
}
