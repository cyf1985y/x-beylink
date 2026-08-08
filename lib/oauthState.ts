import { SignJWT, jwtVerify, errors } from "jose";

/**
 * LINE OAuth 的 CSRF state。
 *
 * 原本把 state 存在 xb_oauth_state cookie 再於 callback 比對，但手機從 LINE
 * 訊息點連結進來時，LINE 會走 app-to-app 授權（內建瀏覽器 → 跳出 LINE app
 * 授權 → 再跳回內建瀏覽器），回程的 request 讀不到去程寫下的 cookie，state
 * 比對必定失敗，畫面就顯示「登入驗證失敗，請重試」。
 *
 * 改法：state 本身做成 jose 簽章的短效 JWT，驗證只靠簽章與有效期，完全不依賴
 * cookie。登入後要導回的頁面（next）也一併放進 payload，取代原本的 xb_next
 * cookie（同樣的理由，那個 cookie 在 LINE 內建瀏覽器一樣讀不到）。
 */

/** 用途宣告，避免其他用同一把金鑰簽出的 JWT（例如 session）被當成 state */
const PURPOSE = "line-oauth-state";
const STATE_TTL = "10m";

export type OAuthState = {
  /** 登入後要導回的站內路徑（未指定則由呼叫端決定預設） */
  next?: string;
};

export type OAuthStateResult =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "expired" | "invalid" };

function secretKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("缺少 NEXTAUTH_SECRET 環境變數");
  return new TextEncoder().encode(secret);
}

/** 僅接受站內絕對路徑，防 open redirect */
export function safeNext(next: string | null | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}

/** 產生要帶去 LINE 授權頁的 state（簽章 JWT，10 分鐘有效） */
export async function createOAuthState(next?: string): Promise<string> {
  return new SignJWT({
    pur: PURPOSE,
    next: safeNext(next),
    // 讓每次授權的 state 都不同（LINE 要求 state 唯一）
    nonce: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(STATE_TTL)
    .sign(secretKey());
}

/** 驗證 callback 帶回來的 state */
export async function verifyOAuthState(
  state: string | null | undefined
): Promise<OAuthStateResult> {
  if (!state) return { ok: false, reason: "invalid" };
  try {
    const { payload } = await jwtVerify(state, secretKey());
    if (payload.pur !== PURPOSE) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      state: {
        next: safeNext(
          typeof payload.next === "string" ? payload.next : undefined
        ),
      },
    };
  } catch (e) {
    if (e instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
