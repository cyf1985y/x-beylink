import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "xb_session";
const SESSION_DAYS = 30;

export type Session = {
  /** users.id（uuid） */
  uid: string;
  /** LINE 顯示名稱（僅供 UI 顯示） */
  name: string;
};

function secretKey(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("缺少 NEXTAUTH_SECRET 環境變數");
  return new TextEncoder().encode(secret);
}

export async function createSessionCookie(session: Session): Promise<void> {
  const token = await new SignJWT({ uid: session.uid, name: session.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.uid !== "string") return null;
    return {
      uid: payload.uid,
      name: typeof payload.name === "string" ? payload.name : "",
    };
  } catch {
    return null;
  }
}

export function clearSessionCookie(): void {
  cookies().delete(COOKIE_NAME);
}
