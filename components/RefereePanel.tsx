"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { removeReferee, type FormResult } from "@/app/host/actions";

const initialState: FormResult = { ok: false };

export type RefereeRow = { refereeId: string; displayName: string };

function RemoveButton({
  eventId,
  refereeId,
}: {
  eventId: string;
  refereeId: string;
}) {
  const [state, formAction] = useFormState(removeReferee, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="referee_id" value={refereeId} />
      <button className="text-xs text-slate-500 hover:text-red-300">
        移除
      </button>
      {state.error && <p className="text-xs text-red-300">{state.error}</p>}
    </form>
  );
}

export function RefereePanel({
  eventId,
  joinUrl,
  qrDataUrl,
  referees,
}: {
  eventId: string;
  joinUrl: string;
  qrDataUrl: string;
  referees: RefereeRow[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-2xl border border-arena-line bg-arena-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-violetx">
          🧑‍⚖️ 裁判（{referees.length}）
        </h3>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-arena-line px-3 py-1.5 text-sm text-slate-400 hover:border-violetx hover:text-violetx"
        >
          {open ? "收合" : "邀請裁判"}
        </button>
      </div>

      {open && (
        <div className="mt-3 text-center">
          <p className="text-xs text-slate-500">
            請現場幫手用手機掃這個 QR（或開下面的連結），LINE
            登入後就能記錄勝負。裁判不能結算發獎。
          </p>
          <div className="mt-3 inline-block rounded-xl bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="裁判邀請 QR" width={180} height={180} />
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(joinUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="mx-auto mt-2 block break-all text-xs text-cyanx hover:underline"
          >
            {copied ? "✅ 已複製連結" : joinUrl}
          </button>
        </div>
      )}

      {referees.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {referees.map((r) => (
            <div
              key={r.refereeId}
              className="flex items-center justify-between rounded-lg border border-arena-line bg-arena px-3 py-2"
            >
              <span className="text-sm">{r.displayName}</span>
              <RemoveButton eventId={eventId} refereeId={r.refereeId} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
