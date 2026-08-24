import { OAUTH_STATE_COOKIE, secureCookie, signOAuthState } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "GITHUB_APP_CLIENT_ID is required." }, { status: 500 });

  const pendingInstallationId = new URL(request.url).searchParams.get("installation_id")?.trim() || undefined;
  const state = await signOAuthState(crypto.randomUUID(), pendingInstallationId);
  (await cookies()).set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 600,
    path: "/api/auth/github/callback",
    sameSite: "lax",
    secure: secureCookie(),
  });

  const baseUrl = process.env.RONIN_BASE_URL || new URL(request.url).origin;
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", `${baseUrl.replace(/\/$/, "")}/api/auth/github/callback`);
  authorize.searchParams.set("scope", "read:user");
  authorize.searchParams.set("state", state);
  return NextResponse.redirect(authorize);
}
