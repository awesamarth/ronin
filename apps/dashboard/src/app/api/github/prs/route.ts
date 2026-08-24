import { authorizeOrgRequest, permissions } from "@/lib/authorization";
import { openPullRequestForGithubRun, openPullRequestForLatestGithubRun } from "@/lib/github-pr";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = await authorizeOrgRequest(request, permissions.prsCreate);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { runId?: string };
    const result = body.runId
      ? await openPullRequestForGithubRun(body.runId, auth.org.orgId)
      : await openPullRequestForLatestGithubRun(auth.org.orgId);
    await prisma.auditLog.create({
      data: {
        orgId: auth.org.orgId,
        runId: result.runId,
        actorType: "user",
        actorId: auth.operator.session.id,
        action: "github.pull_request_requested",
        target: result.prUrl,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open GitHub PR.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
