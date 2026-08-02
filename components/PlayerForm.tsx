"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef } from "react";
import { createPlayer, type ActionResult } from "@/app/me/actions";
import { AVATARS, TAIWAN_CITIES } from "@/lib/moderation";
import { Flash } from "@/components/Flash";

const initialState: ActionResult = { ok: false };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-x w-full disabled:opacity-50"
    >
      {pending ? "處理中…" : label}
    </button>
  );
}

const inputCls =
  "w-full rounded-lg border border-arena-line bg-arena px-3 py-2.5 text-slate-100 outline-none focus:border-cyanx";

export function NewPlayerForm({
  availableRoles,
}: {
  availableRoles: Array<"parent" | "child">;
}) {
  const [state, formAction] = useFormState(createPlayer, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 78 }, (_, i) => currentYear - 3 - i);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  const single = availableRoles.length === 1;

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          身分
        </label>
        {single ? (
          <>
            <input type="hidden" name="role" value={availableRoles[0]} />
            <div
              className={`rounded-xl border px-4 py-3 text-center font-bold ${
                availableRoles[0] === "parent"
                  ? "border-violetx/60 bg-violetx/10 text-violetx"
                  : "border-cyanx/60 bg-cyanx/10 text-cyanx"
              }`}
            >
              {availableRoles[0] === "parent" ? "🧑 家長" : "🧒 小孩"}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="cursor-pointer">
              <input
                type="radio"
                name="role"
                value="child"
                defaultChecked
                className="peer sr-only"
              />
              <span className="block rounded-xl border border-arena-line px-4 py-3 text-center font-bold text-slate-400 transition peer-checked:border-cyanx peer-checked:bg-cyanx/10 peer-checked:text-cyanx">
                🧒 小孩
              </span>
            </label>
            <label className="cursor-pointer">
              <input
                type="radio"
                name="role"
                value="parent"
                className="peer sr-only"
              />
              <span className="block rounded-xl border border-arena-line px-4 py-3 text-center font-bold text-slate-400 transition peer-checked:border-violetx peer-checked:bg-violetx/10 peer-checked:text-violetx">
                🧑 家長
              </span>
            </label>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-500">
          每個帳號可建立家長、小孩各 1 位
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          選手暱稱{" "}
          <span className="font-normal text-slate-500">
            （公開顯示，不要用真實全名）
          </span>
        </label>
        <input
          name="nickname"
          required
          maxLength={12}
          placeholder="例如：旋風小霸王"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-bold text-slate-300">
            出生年（西元）
          </label>
          <select
            name="birth_year"
            required
            defaultValue={currentYear - 8}
            className={inputCls}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-bold text-slate-300">
            居住縣市
          </label>
          <select name="city" required defaultValue="宜蘭縣" className={inputCls}>
            {TAIWAN_CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          戰隊名稱{" "}
          <span className="font-normal text-slate-500">（選填，沒有可留空）</span>
        </label>
        <input
          name="team_name"
          maxLength={15}
          placeholder="例如：宜蘭爆旋小隊"
          className={inputCls}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-bold text-slate-300">
          虛擬頭像
        </label>
        <div className="grid grid-cols-4 gap-2">
          {AVATARS.map((a) => (
            <label key={a} className="cursor-pointer">
              <input
                type="radio"
                name="avatar"
                value={a}
                defaultChecked={a === "🌀"}
                className="peer sr-only"
              />
              <span className="flex h-16 items-center justify-center rounded-xl border border-arena-line bg-arena text-4xl transition peer-checked:border-cyanx peer-checked:bg-cyanx/15 peer-checked:shadow-glow">
                {a}
              </span>
            </label>
          ))}
        </div>
      </div>

      <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
        ⚠️ 選手資料建立後<b>不可修改</b>（比賽現場以此認定本人）。若尚未報名任何賽事，可刪除重建。
      </p>

      <Flash state={state} successText="選手檔案建立成功！" />
      <SubmitButton label="建立選手檔案" />
    </form>
  );
}
