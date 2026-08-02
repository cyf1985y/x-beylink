"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { deletePlayer, type ActionResult } from "@/app/me/actions";
import type { DbPlayer } from "@/lib/supabase";

const initialState: ActionResult = { ok: false };

export function PlayerCard({ player }: { player: DbPlayer }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteState, deleteAction] = useFormState(deletePlayer, initialState);

  const attendanceText =
    player.attendance_total > 0
      ? `${player.attendance_ok}/${player.attendance_total}`
      : "—";
  const banned =
    player.banned_until && new Date(player.banned_until) > new Date();

  return (
    <div className="card-x p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-arena-line bg-arena text-4xl">
          {player.avatar}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-black">{player.nickname}</h3>
            <span
              className={`-skew-x-12 border px-2 py-0.5 text-[10px] font-bold ${
                player.role === "parent"
                  ? "border-violetx/50 bg-violetx/10 text-violetx"
                  : "border-cyanx/50 bg-cyanx/10 text-cyanx"
              }`}
            >
              {player.role === "parent" ? "家長" : "小孩"}
            </span>
            {banned && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
                停權中
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {player.birth_year} 年出生｜{player.city ?? "—"}
            {player.team_name && (
              <span className="text-cyanx">｜🏴 {player.team_name}</span>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            出席 {attendanceText}｜信譽點數 {Number(player.penalty_points)}｜
            <a
              href={`/player/${player.id}`}
              className="text-cyanx hover:underline"
            >
              選手卡
            </a>
          </p>
        </div>
        <div className="text-right text-sm">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-slate-600 hover:text-red-300"
            >
              刪除
            </button>
          ) : (
            <form action={deleteAction}>
              <input type="hidden" name="player_id" value={player.id} />
              <button className="text-red-400 hover:text-red-300">
                確定刪除？
              </button>
            </form>
          )}
        </div>
      </div>

      {deleteState.error && (
        <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {deleteState.error}
        </p>
      )}
    </div>
  );
}
