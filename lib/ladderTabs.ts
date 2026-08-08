/**
 * 天梯頁籤的型別與驗證。
 *
 * 刻意獨立成純模組（不要 "use client"、不要任何 import）：
 * server component 需要解析 ?tab= 這個 query，而 "use client" 模組的匯出
 * 在伺服器端會被換成 client reference 代理，當成函式呼叫會炸
 * （TypeError: c is not a function）。
 */
export type LadderTab = "battle" | "board";

export function isLadderTab(v: unknown): v is LadderTab {
  return v === "battle" || v === "board";
}
