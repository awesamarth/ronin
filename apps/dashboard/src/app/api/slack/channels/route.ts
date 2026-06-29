import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      channelId?: string;
      displayName?: string;
      repoId?: string;
      teamId?: string;
    };

    const platformChannelId = body.channelId?.trim();
    const repoId = body.repoId?.trim();
    const platformTeamId = body.teamId?.trim() || process.env.SLACK_TEAM_ID || "";

    if (!platformChannelId || !repoId) {
      return NextResponse.json({ error: "channelId and repoId are required." }, { status: 400 });
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
        platform: "slack",
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
          platform: "slack",
          platformChannelId,
          platformTeamId,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "slack.channel_mapped",
        actorType: "operator",
        metadata: JSON.stringify({
          channel: channel.displayName,
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
      ok: true,
      channel: {
        id: channel.id,
        displayName: channel.displayName,
        platformChannelId: channel.platformChannelId,
        repo: repo.fullName,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Slack channel mapping failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
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
    if (!channel || channel.platform !== "slack") {
      return NextResponse.json({ error: "Slack route not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.channel.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          action: "slack.channel_unmapped",
          actorType: "operator",
          metadata: JSON.stringify({
            channel: channel.displayName,
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
    const message = error instanceof Error ? error.message : "Slack route deletion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
