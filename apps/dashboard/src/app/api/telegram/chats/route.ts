import { authorizeOrgRequest, permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = await authorizeOrgRequest(request, permissions.integrationsManage);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      chatId?: string;
      displayName?: string;
      repoId?: string;
      botUsername?: string;
      accessMode?: string;
    };

    const platformChannelId = body.chatId?.trim();
    const repoId = body.repoId?.trim();
    const platformTeamId =
      body.botUsername?.trim().replace(/^@/, "") || process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || "";
    const accessMode = body.accessMode === "external" ? "external" : "internal";
    if (accessMode === "external") {
      return NextResponse.json({ error: "External routes require an approved public-knowledge, tool-free execution profile." }, { status: 409 });
    }

    if (!platformChannelId || !repoId) {
      return NextResponse.json({ error: "chatId and repoId are required." }, { status: 400 });
    }

    const repo = await prisma.repository.findFirst({
      include: { org: true },
      where: { id: repoId, orgId: auth.org.orgId },
    });

    if (!repo) {
      return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    }

    const channel = await prisma.$transaction(async (tx) => {
      const mapped = await tx.channel.upsert({
        create: {
          accessMode,
          defaultRepoId: repo.id,
          displayName: body.displayName?.trim() || platformChannelId,
          orgId: repo.orgId,
          platform: "telegram",
          platformChannelId,
          platformTeamId,
        },
        update: {
          accessMode,
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
      await tx.channelRepository.deleteMany({ where: { channelId: mapped.id } });
      await tx.channelRepository.create({ data: { channelId: mapped.id, repoId: repo.id, orgId: repo.orgId } });
      await tx.auditLog.create({
        data: {
          action: "telegram.chat_mapped",
          actorType: "user",
          actorId: auth.operator.session.id,
          metadata: JSON.stringify({ chat: mapped.displayName, platformChannelId, platformTeamId, repo: repo.fullName, accessMode }),
          orgId: repo.orgId,
          repoId: repo.id,
          target: platformChannelId,
        },
      });
      return mapped;
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
  const auth = await authorizeOrgRequest(request, permissions.integrationsManage);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as { id?: string };
    const id = body.id?.trim();
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

    const channel = await prisma.channel.findFirst({
      include: { defaultRepo: true },
      where: { id, orgId: auth.org.orgId },
    });
    if (!channel || channel.platform !== "telegram") {
      return NextResponse.json({ error: "Telegram route not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.channel.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          action: "telegram.chat_unmapped",
          actorType: "user",
          actorId: auth.operator.session.id,
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
