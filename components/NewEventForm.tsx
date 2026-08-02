"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createEvent, type FormResult } from "@/app/host/actions";
import { TIERS, Tier } from "@/lib/events";

const initialState: FormResult = { ok: false };

const DIVISIONS = ["幼兒／國小組", "國中／高中組", "成人組", "其他"] as const;

/** 常用開賽時間（半小時一格 10:00–20:30） */
const TIME_OPTIONS = Array.from({ length: 22 }, (_, i) => {
  const h = 10 + Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-x w-full disabled:opacity-50">
      {pending ? "建立中…" : "建立賽事"}
    </button>
  );
}

const TIER_KEYS: Tier[] = ["bronze", "silver", "gold"];

/** 快速日期：今天起算的常用選項 */
function quickDates(): Array<{ label: string; value: string }> {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  const today = new Date();
  const out: Array<{ label: string; value: string }> = [];
  const add = (d: Date, label: string) => out.push({ label, value: fmt(d) });

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  add(tomorrow, "明天");

  // 本週六／週日（若已過則下週）
  const sat = new Date(today);
  sat.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7 || 7));
  add(sat, `週六 ${sat.getMonth() + 1}/${sat.getDate()}`);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  add(sun, `週日 ${sun.getMonth() + 1}/${sun.getDate()}`);

  const nextSat = new Date(sat);
  nextSat.setDate(sat.getDate() + 7);
  add(nextSat, `下週六 ${nextSat.getMonth() + 1}/${nextSat.getDate()}`);
  return out;
}

const inputCls =
  "w-full rounded-lg border border-arena-line bg-arena px-3 py-2.5 text-slate-100 outline-none focus:border-cyanx";

export function NewEventForm({ tierAllowed }: { tierAllowed: Tier }) {
  const [state, formAction] = useFormState(createEvent, initialState);
  const [tier, setTier] = useState<Tier>("bronze");
  const [date, setDate] = useState("");
  const allowedIdx = TIER_KEYS.indexOf(tierAllowed);
  const presets = quickDates();

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          賽事名稱
        </label>
        <input
          name="title"
          required
          maxLength={40}
          placeholder="例如：週六下午銅級例行賽"
          className={inputCls}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          等級{" "}
          <span className="font-normal text-slate-500">
            （你可開：{TIERS[tierAllowed].label}以下）
          </span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {TIER_KEYS.map((t, i) => {
            const locked = i > allowedIdx;
            return (
              <label key={t} className={locked ? "opacity-40" : "cursor-pointer"}>
                <input
                  type="radio"
                  name="tier"
                  value={t}
                  disabled={locked}
                  checked={tier === t}
                  onChange={() => setTier(t)}
                  className="peer sr-only"
                />
                <span
                  className={`block rounded-xl border px-2 py-2.5 text-center text-sm font-bold transition ${
                    tier === t
                      ? "border-cyanx bg-cyanx/10 text-cyanx"
                      : "border-arena-line text-slate-400"
                  }`}
                >
                  {TIERS[t].label}
                  <span className="block text-[10px] font-normal opacity-70">
                    {locked ? "🔒 未開放" : `滿 ${TIERS[t].minRequired} 人成團`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          開賽日期
        </label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setDate(p.value)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                date === p.value
                  ? "border-cyanx bg-cyanx/15 text-cyanx"
                  : "border-arena-line text-slate-400 hover:border-cyanx/50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            name="starts_date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
          <select name="starts_time" required defaultValue="14:00" className={inputCls}>
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          成行判定自動設在開賽前 24 小時（臨期改為前 2 小時），未達成團門檻自動流局。
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          場地名稱
        </label>
        <input name="venue" required placeholder="例如：宜蘭陀螺基地" className={inputCls} />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          地址
        </label>
        <input
          name="address"
          required
          maxLength={60}
          placeholder="例如：宜蘭縣宜蘭市中山路三段 123 號"
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-500">
          玩家可以在賽事頁一鍵開地圖導航
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-bold text-slate-300">
            組別（年齡層）
          </label>
          <select name="division" required defaultValue="幼兒／國小組" className={inputCls}>
            {DIVISIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold text-slate-300">
            名額上限
          </label>
          <div className="rounded-lg border border-arena-line bg-arena/50 px-3 py-2.5 text-slate-300">
            <span className="font-num font-bold">{TIERS[tier].capacity}</span> 人
            <span className="ml-1 text-xs text-slate-500">
              （{TIERS[tier].label}固定）
            </span>
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
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
