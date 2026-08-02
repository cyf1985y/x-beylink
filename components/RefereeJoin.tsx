"use client";

import { useFormState, useFormStatus } from "react-dom";
import { joinAsReferee, type JoinResult } from "@/app/referee/actions";

const initialState: JoinResult = { ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violetx px-6 py-3 font-bold text-white transition hover:brightness-110 disabled:opacity-50"
    >
      {pending ? "加入中…" : "🧑‍⚖️ 成為本場裁判"}
    </button>
  );
}

export function RefereeJoinForm({ code }: { code: string }) {
  const [state, formAction] = useFormState(joinAsReferee, initialState);
  return (
    <form action={formAction}>
      <input type="hidden" name="code" value={code} />
      <Submit />
      {state.error && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
