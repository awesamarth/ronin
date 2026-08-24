import { secureCookie, SESSION_COOKIE, signOperatorSession, validateRequestOrigin } from "@/lib/auth";
import { getOperatorContext } from "@/lib/authorization";
import { syncGitHubInstallation } from "@/lib/github-app";
import { processQueuedGithubRun } from "@/lib/github-run-processor";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const originError = validateRequestOrigin(request);
  if (originError) return originError;
  const operator = await getOperatorContext();
  if (!operator) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { installationId?: string; process?: boolean };
  const installationId = body.installationId ?? process.env.GITHUB_INSTALLATION_ID;
  if (!installationId) return NextResponse.json({ error: "Missing installationId." }, { status: 400 });

  try {
    const result = await syncGitHubInstallation(installationId, operator.session.id);
    const processedOnboardingRuns = [];
    if (body.process) {
      for (const runId of result.onboardingRunIds) {
        const run = await processQueuedGithubRun(runId, result.org.id);
        processedOnboardingRuns.push({ id: run?.id, repo: run?.repo?.fullName, status: run?.status });
      }
    }

    const session = await signOperatorSession({ ...operator.session, activeOrgId: result.org.id });
    (await cookies()).set(SESSION_COOKIE, session, {
      httpOnly: true,
      maxAge: 43_200,
      path: "/",
      sameSite: "lax",
      secure: secureCookie(),
    });

    return NextResponse.json({
      backgroundProcessing: !body.process,
      ok: true,
      onboardingRunIds: result.onboardingRunIds,
      org: result.org.slug,
      processedOnboardingRuns,
      repositories: result.repositories.map((repo) => repo.full_name),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub installation sync failed." }, { status: 403 });
  }
}
