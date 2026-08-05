"use client";

import { useFormState, useFormStatus } from "react-dom";
import { applyForOrganizer, type FormResult } from "@/app/host/actions";

const initialState: FormResult = { ok: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-x mt-4 w-full disabled:opacity-50"
    >
      {pending ? "送出中…" : "送出申請"}
    </button>
  );
}

/**
 * 主辦方申請表單。只問三件事：店家名稱、聯絡方式、想辦什麼。
 * 刻意不問地址與證件——真的要認證時再私下聯絡，先讓人跑得起來。
 */
export function HostApplyForm({ defaultName }: { defaultName: string }) {
  const [state, formAction] = useFormState(applyForOrganizer, initialState);

  if (state.ok) {
    return (
      <div className="card-x mt-6 p-5 text-center">
        <p className="text-3xl">📮</p>
        <h2 className="mt-2 font-black text-cyanx">申請已送出</h2>
        <p className="mt-2 text-sm text-slate-400">
          平台管理員審核通過後，這一頁就會變成你的主辦方專區，
          並用 LINE 通知你。通常一天內會處理完。
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card-x mt-6 space-y-3 p-5 text-left">
      <div>
        <label className="text-sm font-bold text-slate-300">
          主辦方／店家名稱
        </label>
        <input
          name="shop_name"
          required
          maxLength={30}
          defaultValue={defaultName}
          placeholder="例如：羅東陀螺基地"
          className="mt-1 w-full rounded-xl border border-arena-line bg-arena px-3 py-2.5 text-slate-100 outline-none focus:border-cyanx"
        />
        <p className="mt-1 text-xs text-slate-500">
          會顯示在賽事頁上，讓玩家知道是誰主辦
        </p>
      </div>

      <div>
        <label className="text-sm font-bold text-slate-300">聯絡方式</label>
        <input
          name="contact"
          required
          maxLength={60}
          placeholder="手機或 LINE ID"
          className="mt-1 w-full rounded-xl border border-arena-line bg-arena px-3 py-2.5 text-slate-100 outline-none focus:border-cyanx"
        />
        <p className="mt-1 text-xs text-slate-500">
          只有平台管理員看得到，不會公開
        </p>
      </div>

      <div>
        <label className="text-sm font-bold text-slate-300">
          想辦什麼賽事？<span className="text-slate-500">（選填）</span>
        </label>
        <textarea
          name="note"
          maxLength={200}
          rows={3}
          placeholder="例如：每週六下午在店裡辦銅級賽，大概 16 人"
          className="mt-1 w-full rounded-xl border border-arena-line bg-arena px-3 py-2.5 text-slate-100 outline-none focus:border-cyanx"
        />
      </div>

      {state.error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <Submit />
      <p className="text-center text-xs text-slate-500">
        新主辦方從銅級開始，辦滿 3 場後解鎖銀級
      </p>
    </form>
  );
}
