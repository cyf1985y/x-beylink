/**
 * 畫面頂端的白話狀態橫幅。
 *
 * 現場是 6–12 歲的小孩自己拿著手機在操作，畫面上有什麼按鈕不等於他知道
 * 「現在輪到我做什麼」。每個狀態都用一句白話講完下一步要幹嘛。
 */
export function StatusBanner({
  tone = "info",
  children,
}: {
  tone?: "info" | "wait" | "done" | "alert";
  children: React.ReactNode;
}) {
  const style = {
    info: "border-cyanx/50 bg-cyanx/10 text-cyanx",
    wait: "border-gold/50 bg-gold/10 text-gold",
    done: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
    alert: "border-red-400/50 bg-red-500/10 text-red-300",
  }[tone];

  return (
    <p
      className={`rounded-xl border px-3 py-2 text-center text-sm font-bold ${style}`}
    >
      {children}
    </p>
  );
}
