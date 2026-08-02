"use client";

import { useEffect, useRef, useState } from "react";

type FlashState = { ok: boolean; error?: string; message?: string };

/**
 * 操作結果提示：每次動作完成時顯示，5 秒後自動消失。
 * 修正「上一次操作的訊息殘留在畫面上」的問題。
 * 以 state 物件識別變化（useFormState 每次動作都會回傳新物件），
 * 相同文字的錯誤連續發生也會重新顯示。
 */
export function Flash({
  state,
  successText,
}: {
  state: FlashState;
  successText?: string;
}) {
  const [visible, setVisible] = useState(false);
  const first = useRef(true);

  const error = state.error ?? null;
  const success = state.ok ? (state.message ?? successText ?? null) : null;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return; // 初始掛載（initialState）不顯示
    }
    if (!error && !success) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!visible) return null;
  if (error) {
    return (
      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
        ✅ {success}
      </p>
    );
  }
  return null;
}
