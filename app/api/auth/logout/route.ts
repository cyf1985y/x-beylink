import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";
import { baseUrl } from "@/lib/line";

export const dynamic = "force-dynamic";

export async function POST() {
  clearSessionCookie();
  return NextResponse.redirect(`${baseUrl()}/`, { status: 303 });
}
