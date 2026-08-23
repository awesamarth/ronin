import { secureCookie, SESSION_COOKIE } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: secureCookie(),
  });
  return NextResponse.redirect(new URL("/login", process.env.RONIN_BASE_URL || request.url), 303);
}
