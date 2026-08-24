import { authorizeOrgRequest, permissions } from "@/lib/authorization";
import { processLatestQueuedGithubRun, processQueuedGithubRun } from "@/lib/github-run-processor";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = await authorizeOrgRequest(request, permissions.runsExecute);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { runId?: string };
    const run = body.runId
      ? await processQueuedGithubRun(body.runId, auth.org.orgId)
      : await processLatestQueuedGithubRun(auth.org.orgId);

    if (!run) return NextResponse.json({ ok: true, run: null, message: "No queued GitHub run found." });
    await prisma.auditLog.create({
      data: {
        orgId: auth.org.orgId,
        runId: run.id,
        repoId: run.repoId,
        actorType: "user",
        actorId: auth.operator.session.id,
        action: "run.process_requested",
        target: run.id,
      },
    });
    return NextResponse.json({
      ok: true,
      run: {
        id: run.id,
        status: run.status,
        repo: run.repo?.fullName,
        artifacts: "artifacts" in run ? run.artifacts?.length : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Run processing failed." },
      { status: 500 },
    );
  }
}
