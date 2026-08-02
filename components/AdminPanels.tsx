"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  createOrganizer,
  updateOrganizer,
  type AdminResult,
} from "@/app/admin/actions";
import { TIERS, Tier } from "@/lib/events";

const initialState: AdminResult = { ok: false };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-cyanx px-3 py-1.5 text-sm font-bold text-arena hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

function Msg({ state }: { state: AdminResult }) {
  if (state.error) {
    return <p className="mt-2 text-xs text-red-300">{state.error}</p>;
  }
  if (state.ok) return <p className="mt-2 text-xs text-emerald-300">✅ 已更新</p>;
  return null;
}

export function CreateOrganizerForm({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const [state, formAction] = useFormState(createOrganizer, initialState);
  return (
    <form action={formAction} className="mt-2 flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input
        name="name"
        required
        maxLength={30}
        placeholder={`主辦方名稱（例如 ${displayName} 的店）`}
        className="min-w-0 flex-1 rounded-lg border border-arena-line bg-arena px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-cyanx"
      />
      <Submit label="開通主辦方" />
      <Msg state={state} />
    </form>
  );
}

export function EditOrganizerForm({
  organizerId,
  verified,
  tierAllowed,
}: {
  organizerId: string;
  verified: boolean;
  tierAllowed: Tier;
}) {
  const [state, formAction] = useFormState(updateOrganizer, initialState);
  return (
    <form action={formAction} className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="organizer_id" value={organizerId} />
        <label className="flex items-center gap-1.5 text-sm text-slate-300">
          <input
            type="checkbox"
            name="verified"
            defaultChecked={verified}
            className="accent-cyanx"
          />
          已認證
        </label>
        <select
          name="tier_allowed"
          defaultValue={tierAllowed}
          className="rounded-lg border border-arena-line bg-arena px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyanx"
        >
          {(Object.keys(TIERS) as Tier[]).map((t) => (
            <option key={t} value={t}>
              可開到{TIERS[t].label}
            </option>
          ))}
        </select>
        <Submit label="儲存" />
      </div>
      <Msg state={state} />
    </form>
  );
}
