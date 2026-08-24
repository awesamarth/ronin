import {
  allowedGithubLogin,
  OAUTH_STATE_COOKIE,
  secureCookie,
  SESSION_COOKIE,
  signOperatorSession,
  verifyOAuthState,
} from "@/lib/auth";
import { upsertUserIdentity } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
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

  const verifiedState = state && state === stateCookie ? await verifyOAuthState(state) : null;
  if (!code || !verifiedState) return fail();
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

    const roninUser = await upsertUserIdentity({
      provider: "github",
      providerAccountId: String(user.id),
      login: user.login,
      displayName: user.name || user.login,
      avatarUrl: user.avatar_url || undefined,
    });
    const installationsResponse = await fetch("https://api.github.com/user/installations?per_page=100", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${tokenBody.access_token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (installationsResponse.ok) {
      const installations = (await installationsResponse.json()) as { installations?: Array<{ id: number }> };
      await prisma.$transaction([
        prisma.gitHubInstallationAccess.deleteMany({ where: { userId: roninUser.id } }),
        ...(installations.installations ?? []).map((installation) =>
          prisma.gitHubInstallationAccess.create({ data: { userId: roninUser.id, installationId: String(installation.id) } }),
        ),
      ]);
    }

    const activeOrgId =
      (roninUser.lastActiveOrgId && roninUser.memberships.some((membership) => membership.status === "active" && membership.orgId === roninUser.lastActiveOrgId)
        ? roninUser.lastActiveOrgId
        : roninUser.memberships.filter((membership) => membership.status === "active").length === 1
          ? roninUser.memberships.find((membership) => membership.status === "active")?.orgId
          : undefined);
    const session = await signOperatorSession({
      id: roninUser.id,
      login: user.login,
      name: user.name || undefined,
      avatarUrl: user.avatar_url || undefined,
      activeOrgId,
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
    const pendingInstallationId = verifiedState.pendingInstallationId;
    const verifiedPendingInstallation = pendingInstallationId
      ? await prisma.gitHubInstallationAccess.findUnique({ where: { userId_installationId: { userId: roninUser.id, installationId: pendingInstallationId } } })
      : null;
    return NextResponse.redirect(
      pendingInstallationId && verifiedPendingInstallation
        ? `${baseUrl}/?installation_id=${encodeURIComponent(pendingInstallationId)}&verified_installation=1`
        : baseUrl,
    );
  } catch {
    return fail();
  }
}
