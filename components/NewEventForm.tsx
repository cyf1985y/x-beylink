"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createEvent, type FormResult } from "@/app/host/actions";
import { TIERS, Tier } from "@/lib/events";

const initialState: FormResult = { ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-cyanx px-4 py-3 font-bold text-arena transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "建立中…" : "建立賽事"}
    </button>
  );
}

const TIER_KEYS: Tier[] = ["bronze", "silver", "gold"];

export function NewEventForm({ tierAllowed }: { tierAllowed: Tier }) {
  const [state, formAction] = useFormState(createEvent, initialState);
  const allowedIdx = TIER_KEYS.indexOf(tierAllowed);

  const inputCls =
    "w-full rounded-lg border border-arena-line bg-arena px-3 py-2 text-slate-100 outline-none focus:border-cyanx";

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-slate-300">賽事名稱</label>
        <input
          name="title"
          required
          maxLength={40}
          placeholder="例如：週六下午銅級例行賽"
          className={inputCls}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">
          等級{" "}
          <span className="text-slate-500">
            （你可開：{TIERS[tierAllowed].label}以下；成團門檻由等級決定）
          </span>
        </label>
        <select name="tier" required className={inputCls} defaultValue="bronze">
          {TIER_KEYS.map((t, i) => (
            <option key={t} value={t} disabled={i > allowedIdx}>
              {TIERS[t].label}｜{TIERS[t].freq}｜滿 {TIERS[t].minRequired} 人成團
              {i > allowedIdx ? "（未開放）" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">
          開賽時間（台灣時間）
        </label>
        <input name="starts_at" type="datetime-local" required className={inputCls} />
        <p className="mt-1 text-xs text-slate-500">
          成行判定時間自動設在開賽前 24 小時（若開賽在 26 小時內則為前 2
          小時），未達成團門檻自動流局。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm text-slate-300">場地</label>
          <input name="venue" required placeholder="例如：宜蘭陀螺基地" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">地區</label>
          <input name="region" defaultValue="宜蘭" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm text-slate-300">組別</label>
          <select name="division" className={inputCls} defaultValue="通常組">
            <option>通常組</option>
            <option>公開組</option>
            <option>親子組</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-slate-300">名額上限</label>
          <input
            name="capacity"
            type="number"
            min={8}
            max={128}
            defaultValue={16}
            required
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">
          規則說明（選填）
        </label>
        <textarea
          name="rules_note"
          rows={3}
          maxLength={500}
          placeholder="賽制、自備裝備、注意事項…"
          className={inputCls}
        />
      </div>

      {state.error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}
