"use client";

import { useEffect, useState } from "react";
import { getMatchScore } from "@/app/referee/scoring";
import { WIN_POINTS } from "@/lib/bracket";

type P = { id: string; nickname: string; avatar: string };

/** 計分板：大字比分，2 秒輪詢更新，適合橫放的平板／筆電架在戰鬥盤旁 */
export function ScoreboardLive({
  matchId,
  title,
  roundLabel,
  tableNo,
  player1,
  player2,
  initialScore1,
  initialScore2,
  initialWinnerId,
}: {
  matchId: string;
  title: string;
  roundLabel: string;
  tableNo: number;
  player1: P;
  player2: P;
  initialScore1: number;
  initialScore2: number;
  initialWinnerId: string | null;
}) {
  const [s1, setS1] = useState(initialScore1);
  const [s2, setS2] = useState(initialScore2);
  const [winnerId, setWinnerId] = useState<string | null>(initialWinnerId);

  useEffect(() => {
    const timer = setInterval(async () => {
      const r = await getMatchScore(matchId);
      if (!r) return;
      setS1(r.score1);
      setS2(r.score2);
      setWinnerId(r.winnerId);
    }, 2000);
    return () => clearInterval(timer);
  }, [matchId]);

  const Side = ({
    p,
    score,
    accent,
  }: {
    p: P;
    score: number;
    accent: "cyan" | "violet";
  }) => {
    const won = !!winnerId && winnerId === p.id;
    const lost = !!winnerId && winnerId !== p.id;
    return (
      <div
        className={`flex flex-1 flex-col items-center justify-center rounded-3xl border-2 p-6 transition ${
          won
            ? "border-gold bg-gold/15 shadow-glow-gold"
            : lost
              ? "border-arena-line opacity-40"
              : accent === "cyan"
                ? "border-cyanx/50 bg-cyanx/5"
                : "border-violetx/50 bg-violetx/5"
        }`}
      >
        <span className="text-[12vh] leading-none">{p.avatar}</span>
        <p className="mt-3 max-w-full truncate text-[4vh] font-black">
          {p.nickname}
        </p>
        <p
          className={`font-num text-[22vh] font-bold leading-none ${
            won ? "text-gold" : "text-slate-100"
          }`}
        >
          {score}
        </p>
        {won && <p className="text-[3vh] font-black text-gold">WINNER 🏆</p>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-arena-deep p-4">
      <header className="text-center">
        <p className="text-[2.4vh] font-black tracking-widest text-cyanx">
          {roundLabel}・第 {tableNo} 決鬥台
        </p>
        <p className="text-[1.8vh] text-slate-500">{title}</p>
      </header>

      <div className="flex flex-1 items-stretch gap-4 py-3">
        <Side p={player1} score={s1} accent="cyan" />
        <div className="flex items-center">
          <span className="font-num text-[5vh] font-bold text-violetx">VS</span>
        </div>
        <Side p={player2} score={s2} accent="violet" />
      </div>

      <footer className="text-center text-[1.8vh] text-slate-600">
        先取得 {WIN_POINTS} 分者獲勝｜陀螺集結 X-BeyLink
      </footer>
    </div>
  );
}
