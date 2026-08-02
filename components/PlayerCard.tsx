"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { deletePlayer, type ActionResult } from "@/app/me/actions";
import { EditPlayerForm } from "@/components/PlayerForm";
import type { DbPlayer } from "@/lib/supabase";

const initialState: ActionResult = { ok: false };

export function PlayerCard({ player }: { player: DbPlayer }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteState, deleteAction] = useFormState(deletePlayer, initialState);

  const attendanceText =
    player.attendance_total > 0
      ? `${player.attendance_ok}/${player.attendance_total}`
      : "—";
  const banned =
    player.banned_until && new Date(player.banned_until) > new Date();

  return (
    <div className="rounded-2xl border border-arena-line bg-arena-card p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-arena-line bg-arena text-3xl">
          {player.avatar}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-bold">{player.nickname}</h3>
            {banned && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
                停權中
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-400">
            {player.birth_year} 年出生
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
        <div className="flex flex-col gap-1 text-right text-sm">
          <button
            onClick={() => {
              setEditing((v) => !v);
              setConfirmDelete(false);
            }}
            className="text-cyanx hover:brightness-125"
          >
            {editing ? "收合" : "編輯"}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-slate-500 hover:text-red-300"
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

      {editing && (
        <div className="mt-4 border-t border-arena-line pt-4">
          <EditPlayerForm
            playerId={player.id}
            defaults={{
              nickname: player.nickname,
              birth_year: player.birth_year,
              avatar: player.avatar,
            }}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
