import { openPullRequestForGithubRun, openPullRequestForLatestGithubRun } from "@/lib/github-pr";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { runId?: string };
    const result = body.runId ? await openPullRequestForGithubRun(body.runId) : await openPullRequestForLatestGithubRun();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open GitHub PR.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
