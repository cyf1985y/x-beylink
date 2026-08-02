"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  registerPlayer,
  cancelRegistration,
  type ActionResult,
} from "@/app/event/actions";
import { Flash } from "@/components/Flash";

const initialState: ActionResult = { ok: false };

export type PlayerRegState = {
  playerId: string;
  nickname: string;
  avatar: string;
  banned: boolean;
  registrationId: string | null;
  regStatus: "ok" | "waitlist" | null;
};

function Pending({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-cyanx px-4 py-1.5 text-sm font-bold text-arena transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

function CancelBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-arena-line px-4 py-1.5 text-sm text-slate-400 transition hover:border-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {pending ? "…" : "取消報名"}
    </button>
  );
}

function PlayerRow({
  eventId,
  p,
  closed,
}: {
  eventId: string;
  p: PlayerRegState;
  closed: boolean;
}) {
  const [regState, regAction] = useFormState(registerPlayer, initialState);
  const [cancelState, cancelAction] = useFormState(
    cancelRegistration,
    initialState
  );
  const state = p.registrationId ? cancelState : regState;

  return (
    <div className="rounded-xl border border-arena-line bg-arena p-3">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{p.avatar}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{p.nickname}</p>
          {p.regStatus === "ok" && (
            <p className="text-xs text-emerald-300">
              ✅ 已報名 ·{" "}
              <a
                href={`/ticket/${p.registrationId}`}
                className="underline hover:text-emerald-200"
              >
                報到憑證
              </a>
            </p>
          )}
          {p.regStatus === "waitlist" && (
            <p className="text-xs text-gold">⏳ 候補中</p>
          )}
          {p.banned && <p className="text-xs text-red-300">停權中</p>}
        </div>
        {p.registrationId ? (
          <form action={cancelAction}>
            <input
              type="hidden"
              name="registration_id"
              value={p.registrationId}
            />
            <CancelBtn />
          </form>
        ) : closed || p.banned ? null : (
          <form action={regAction}>
            <input type="hidden" name="event_id" value={eventId} />
            <input type="hidden" name="player_id" value={p.playerId} />
            <Pending label="報名" />
          </form>
        )}
      </div>
      <div className="mt-2 empty:mt-0">
        <Flash state={state} />
      </div>
    </div>
  );
}

export function RegistrationPanel({
  eventId,
  players,
  closed,
}: {
  eventId: string;
  players: PlayerRegState[];
  closed: boolean;
}) {
  return (
    <div className="space-y-2">
      {players.map((p) => (
        <PlayerRow key={p.playerId} eventId={eventId} p={p} closed={closed} />
      ))}
    </div>
  );
}
