"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  createOrganizer,
  updateOrganizer,
  approveApplication,
  rejectApplication,
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
  score,
}: {
  organizerId: string;
  verified: boolean;
  tierAllowed: Tier;
  score: number;
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
              認證後可開到{TIERS[t].label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-300">
          積分
          <input
            type="number"
            name="score"
            defaultValue={score}
            min={0}
            className="w-20 rounded-lg border border-arena-line bg-arena px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-gold"
          />
        </label>
        <Submit label="儲存" />
      </div>
      <Msg state={state} />
    </form>
  );
}

function RejectSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-arena-line px-3 py-1.5 text-sm text-slate-400 transition hover:border-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {pending ? "…" : "婉拒"}
    </button>
  );
}

/**
 * 待審申請卡片：核准與婉拒各自一個 form。
 * 核准是主要動作（放大、亮色），婉拒需要填原因，對方看得到。
 */
export function ApplicationCard({
  applicationId,
  shopName,
  contact,
  note,
  displayName,
  appliedAt,
}: {
  applicationId: string;
  shopName: string;
  contact: string;
  note: string | null;
  displayName: string;
  appliedAt: string;
}) {
  const [approveState, approveAction] = useFormState(
    approveApplication,
    initialState
  );
  const [rejectState, rejectAction] = useFormState(
    rejectApplication,
    initialState
  );

  return (
    <div className="rounded-2xl border border-gold/50 bg-gold/5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-black text-gold">🏟 {shopName}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            申請人 {displayName}｜{appliedAt}
          </p>
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-300">📞 {contact}</p>
      {note && <p className="mt-1 text-sm text-slate-400">💬 {note}</p>}

      <form action={approveAction} className="mt-3">
        <input type="hidden" name="application_id" value={applicationId} />
        <Submit label="✓ 核准開通（銅級）" />
      </form>
      <Msg state={approveState} />

      <form action={rejectAction} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="application_id" value={applicationId} />
        <input
          name="reject_reason"
          maxLength={100}
          placeholder="婉拒原因（選填，申請人看得到）"
          className="min-w-0 flex-1 rounded-lg border border-arena-line bg-arena px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-red-400"
        />
        <RejectSubmit />
      </form>
      <Msg state={rejectState} />
    </div>
  );
}
