"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  settleEvent,
  revokeTrophy,
  type FormResult,
} from "@/app/host/actions";

const initialState: FormResult = { ok: false };

export type SettleRow = {
  regId: string;
  nickname: string;
  avatar: string;
  checkedIn: boolean;
};

export type IssuedTrophy = {
  trophyId: string;
  nickname: string;
  rank: number;
  revoked: boolean;
  canRevoke: boolean;
};

export const RANK_LABEL: Record<number, string> = {
  1: "🥇 冠軍",
  2: "🥈 亞軍",
  3: "🥉 季軍",
  4: "🎖️ 殿軍",
  8: "🎗️ 八強",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-gold px-4 py-3 font-bold text-arena transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "結算中…" : "送出結算並發放獎盃"}
    </button>
  );
}

export function SettlePanel({
  eventId,
  rows,
}: {
  eventId: string;
  rows: SettleRow[];
}) {
  const [state, formAction] = useFormState(settleEvent, initialState);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="event_id" value={eventId} />
      <p className="text-xs text-slate-500">
        為已報到的選手指定名次（1–4 名各一位，八強可多位；沒有名次的留空）。
        送出後：發放數位獎盃、未報到者記 1 點信譽、賽事結束。
        <span className="text-gold">此動作不可重來</span>，獎盃誤發 48
        小時內可個別撤回。
      </p>

      {rows.map((r) => (
        <div
          key={r.regId}
          className="flex items-center gap-3 rounded-xl border border-arena-line bg-arena p-3"
        >
          <span className="text-xl">{r.avatar}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{r.nickname}</p>
            {!r.checkedIn && (
              <p className="text-xs text-red-300">未報到（將記 1 點）</p>
            )}
          </div>
          {r.checkedIn && (
            <select
              name={`rank_${r.regId}`}
              defaultValue=""
              className="rounded-lg border border-arena-line bg-arena-card px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-gold"
            >
              <option value="">—</option>
              <option value="1">🥇 1</option>
              <option value="2">🥈 2</option>
              <option value="3">🥉 3</option>
              <option value="4">🎖️ 4</option>
              <option value="8">八強</option>
            </select>
          )}
        </div>
      ))}

      {state.error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
          ✅ 結算完成，獎盃已發放！
        </p>
      )}

      {confirming ? (
        <Submit />
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full rounded-xl border border-gold/60 px-4 py-3 font-bold text-gold transition hover:bg-gold/10"
        >
          結算發獎…
        </button>
      )}
    </form>
  );
}

function RevokeButton({ trophyId }: { trophyId: string }) {
  const [state, formAction] = useFormState(revokeTrophy, initialState);
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={formAction} className="text-right">
      <input type="hidden" name="trophy_id" value={trophyId} />
      {confirming ? (
        <button className="text-xs text-red-400 hover:text-red-300">
          確定撤回？
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-slate-500 hover:text-red-300"
        >
          撤回
        </button>
      )}
      {state.error && <p className="mt-1 text-xs text-red-300">{state.error}</p>}
    </form>
  );
}

export function TrophyList({ trophies }: { trophies: IssuedTrophy[] }) {
  return (
    <div className="space-y-2">
      {trophies.map((t) => (
        <div
          key={t.trophyId}
          className={`flex items-center gap-3 rounded-xl border border-arena-line bg-arena p-3 ${
            t.revoked ? "opacity-50" : ""
          }`}
        >
          <span className="text-sm font-bold text-gold">
            {RANK_LABEL[t.rank] ?? `第 ${t.rank} 名`}
          </span>
          <span className="min-w-0 flex-1 truncate font-bold">{t.nickname}</span>
          {t.revoked ? (
            <span className="text-xs text-slate-500">已撤回</span>
          ) : t.canRevoke ? (
            <RevokeButton trophyId={t.trophyId} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
