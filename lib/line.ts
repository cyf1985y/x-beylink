/** LINE Login OAuth 2.0 輔助函式（手刻流程，不用 NextAuth） */

const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const PROFILE_URL = "https://api.line.me/v2/profile";

export function baseUrl(): string {
  const url = process.env.NEXTAUTH_URL;
  if (!url) throw new Error("缺少 NEXTAUTH_URL 環境變數");
  return url.replace(/\/$/, "");
}

export function lineRedirectUri(): string {
  return `${baseUrl()}/api/auth/callback/line`;
}

export function lineAuthorizeUrl(state: string): string {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) throw new Error("缺少 LINE_LOGIN_CHANNEL_ID 環境變數");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: lineRedirectUri(),
    state,
    scope: "profile openid",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string
): Promise<{ access_token: string }> {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!channelId || !channelSecret) {
    throw new Error("缺少 LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: lineRedirectUri(),
      client_id: channelId,
      client_secret: channelSecret,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`LINE token 交換失敗（${res.status}）`);
  }
  return res.json();
}

export async function fetchLineProfile(accessToken: string): Promise<{
  userId: string;
  displayName: string;
}> {
  const res = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`取得 LINE 個人資料失敗（${res.status}）`);
  }
  return res.json();
}
