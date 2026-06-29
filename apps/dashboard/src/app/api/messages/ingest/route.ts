import { ingestSupportMessage } from "@/lib/message-ingest";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      platform?: string;
      platformTeamId?: string;
      channelId?: string;
      channelName?: string;
      userId?: string;
      userName?: string;
      text?: string;
    };

    if (!body.platform || !body.channelId || !body.userId || !body.text) {
      return NextResponse.json(
        {
          ok: false,
          error: "platform, channelId, userId, and text are required.",
        },
        { status: 400 },
      );
    }

    const result = await ingestSupportMessage({
      platform: body.platform,
      platformTeamId: body.platformTeamId,
      channelId: body.channelId,
      channelName: body.channelName,
      userId: body.userId,
      userName: body.userName,
      text: body.text,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Message ingest failed.",
      },
      { status: 500 },
    );
  }
}
