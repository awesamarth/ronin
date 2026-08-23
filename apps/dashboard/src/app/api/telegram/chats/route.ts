import { authorizeMutation } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const unauthorized = await authorizeMutation(request);
  if (unauthorized) return unauthorized;
  try {
    const body = (await request.json()) as {
      chatId?: string;
      displayName?: string;
      repoId?: string;
      botUsername?: string;
    };

    const platformChannelId = body.chatId?.trim();
    const repoId = body.repoId?.trim();
    const platformTeamId =
      body.botUsername?.trim().replace(/^@/, "") || process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || "";

    if (!platformChannelId || !repoId) {
      return NextResponse.json({ error: "chatId and repoId are required." }, { status: 400 });
    }

    const repo = await prisma.repository.findUnique({
      include: {
        org: true,
      },
      where: {
        id: repoId,
      },
    });

    if (!repo) {
      return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    }

    const channel = await prisma.channel.upsert({
      create: {
        allowedRepoIds: repo.id,
        defaultRepoId: repo.id,
        displayName: body.displayName?.trim() || platformChannelId,
        orgId: repo.orgId,
        platform: "telegram",
        platformChannelId,
        platformTeamId,
      },
      update: {
        allowedRepoIds: repo.id,
        defaultRepoId: repo.id,
        displayName: body.displayName?.trim() || platformChannelId,
        orgId: repo.orgId,
      },
      where: {
        platform_platformTeamId_platformChannelId: {
          platform: "telegram",
          platformChannelId,
          platformTeamId,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "telegram.chat_mapped",
        actorType: "operator",
        metadata: JSON.stringify({
          chat: channel.displayName,
          platformChannelId,
          platformTeamId,
          repo: repo.fullName,
        }),
        orgId: repo.orgId,
        repoId: repo.id,
        target: platformChannelId,
      },
    });

    revalidatePath("/");

    return NextResponse.json({
      chat: {
        displayName: channel.displayName,
        id: channel.id,
        platformChannelId: channel.platformChannelId,
        repo: repo.fullName,
      },
      ok: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram chat mapping failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await authorizeMutation(request);
  if (unauthorized) return unauthorized;
  try {
    const body = (await request.json()) as { id?: string };
    const id = body.id?.trim();
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const channel = await prisma.channel.findUnique({
      include: {
        defaultRepo: true,
      },
      where: { id },
    });
    if (!channel || channel.platform !== "telegram") {
      return NextResponse.json({ error: "Telegram route not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.channel.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          action: "telegram.chat_unmapped",
          actorType: "operator",
          metadata: JSON.stringify({
            chat: channel.displayName,
            platformChannelId: channel.platformChannelId,
            platformTeamId: channel.platformTeamId,
            repo: channel.defaultRepo?.fullName,
          }),
          orgId: channel.orgId,
          repoId: channel.defaultRepoId,
          target: channel.platformChannelId,
        },
      }),
    ]);

    revalidatePath("/");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram route deletion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
