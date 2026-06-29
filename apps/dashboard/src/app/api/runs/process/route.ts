import { processLatestQueuedGithubRun, processQueuedGithubRun } from "@/lib/github-run-processor";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { runId?: string };
    const run = body.runId ? await processQueuedGithubRun(body.runId) : await processLatestQueuedGithubRun();

    if (!run) {
      return NextResponse.json({ ok: true, run: null, message: "No queued GitHub run found." });
    }

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
      {
        ok: false,
        error: error instanceof Error ? error.message : "Run processing failed.",
      },
      { status: 500 },
    );
  }
}
