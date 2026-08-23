import {
  allowedGithubLogin,
  OAUTH_STATE_COOKIE,
  secureCookie,
  SESSION_COOKIE,
  signOperatorSession,
  verifyOAuthState,
} from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

type GithubUser = { id: number; login: string; name?: string | null; avatar_url?: string | null };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const baseUrl = (process.env.RONIN_BASE_URL || url.origin).replace(/\/$/, "");
  const fail = () => NextResponse.redirect(`${baseUrl}/login?error=oauth`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || state !== stateCookie || !(await verifyOAuthState(state))) return fail();
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail();

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const tokenBody = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) return fail();

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${tokenBody.access_token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!userResponse.ok) return fail();
    const user = (await userResponse.json()) as GithubUser;
    if (!user.login || !allowedGithubLogin(user.login)) return fail();

    const session = await signOperatorSession({
      id: String(user.id),
      login: user.login,
      name: user.name || undefined,
      avatarUrl: user.avatar_url || undefined,
    });
    cookieStore.set(SESSION_COOKIE, session, {
      httpOnly: true,
      maxAge: 43_200,
      path: "/",
      sameSite: "lax",
      secure: secureCookie(),
    });
    cookieStore.set(OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/api/auth/github/callback",
      sameSite: "lax",
      secure: secureCookie(),
    });
    return NextResponse.redirect(baseUrl);
  } catch {
    return fail();
  }
}
