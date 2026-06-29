import { handleGitHubWebhook } from "@/lib/github-webhooks";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await handleGitHubWebhook({
    deliveryId: request.headers.get("x-github-delivery"),
    eventName: request.headers.get("x-github-event"),
    signature256: request.headers.get("x-hub-signature-256"),
    rawBody,
  });

  return NextResponse.json(result.body, { status: result.status });
}
