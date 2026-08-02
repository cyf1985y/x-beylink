"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useEffect, useRef } from "react";
import {
  createPlayer,
  updatePlayer,
  type ActionResult,
} from "@/app/me/actions";
import { AVATARS } from "@/lib/moderation";

const initialState: ActionResult = { ok: false };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-cyanx px-4 py-2.5 font-bold text-arena transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "處理中…" : label}
    </button>
  );
}

function PlayerFields({
  defaults,
}: {
  defaults?: { nickname: string; birth_year: number; avatar: string };
}) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 78 }, (_, i) => currentYear - 3 - i);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-slate-300">
          選手暱稱 <span className="text-slate-500">（公開顯示，不要用真實全名）</span>
        </label>
        <input
          name="nickname"
          required
          maxLength={12}
          defaultValue={defaults?.nickname}
          placeholder="例如：旋風小霸王"
          className="w-full rounded-lg border border-arena-line bg-arena px-3 py-2 text-slate-100 outline-none focus:border-cyanx"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">出生年（西元）</label>
        <select
          name="birth_year"
          required
          defaultValue={defaults?.birth_year ?? currentYear - 8}
          className="w-full rounded-lg border border-arena-line bg-arena px-3 py-2 text-slate-100 outline-none focus:border-cyanx"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">虛擬頭像</label>
        <div className="grid grid-cols-8 gap-1">
          {AVATARS.map((a) => (
            <label key={a} className="cursor-pointer">
              <input
                type="radio"
                name="avatar"
                value={a}
                defaultChecked={(defaults?.avatar ?? "🌀") === a}
                className="peer sr-only"
              />
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-arena-line text-lg peer-checked:border-cyanx peer-checked:bg-cyanx/15">
                {a}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorMsg({ state }: { state: ActionResult }) {
  if (!state.error) return null;
  return (
    <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {state.error}
    </p>
  );
}

export function NewPlayerForm() {
  const [state, formAction] = useFormState(createPlayer, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <PlayerFields />
      <ErrorMsg state={state} />
      <SubmitButton label="建立選手檔案" />
    </form>
  );
}

export function EditPlayerForm({
  playerId,
  defaults,
  onDone,
}: {
  playerId: string;
  defaults: { nickname: string; birth_year: number; avatar: string };
  onDone?: () => void;
}) {
  const [state, formAction] = useFormState(updatePlayer, initialState);

  useEffect(() => {
    if (state.ok) onDone?.();
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="player_id" value={playerId} />
      <PlayerFields defaults={defaults} />
      <ErrorMsg state={state} />
      <SubmitButton label="儲存變更" />
    </form>
  );
}
