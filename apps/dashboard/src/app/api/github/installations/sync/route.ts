import { authorizeMutation } from "@/lib/auth";
import { syncGitHubInstallation } from "@/lib/github-app";
import { processQueuedGithubRun } from "@/lib/github-run-processor";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await authorizeMutation(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => ({}))) as { installationId?: string };
  const shouldProcessInline = body && "process" in body ? Boolean((body as { process?: boolean }).process) : false;
  const installationId = body.installationId ?? process.env.GITHUB_INSTALLATION_ID;

  if (!installationId) {
    return NextResponse.json({ error: "Missing installationId." }, { status: 400 });
  }

  const result = await syncGitHubInstallation(installationId);
  const processedOnboardingRuns = [];

  if (shouldProcessInline) {
    for (const runId of result.onboardingRunIds) {
      const run = await processQueuedGithubRun(runId);
      processedOnboardingRuns.push({
        id: run?.id,
        repo: run?.repo?.fullName,
        status: run?.status,
      });
    }
  }

  return NextResponse.json({
    backgroundProcessing: !shouldProcessInline,
    ok: true,
    onboardingRunIds: result.onboardingRunIds,
    org: result.org.slug,
    processedOnboardingRuns,
    repositories: result.repositories.map((repo) => repo.full_name),
  });
}
