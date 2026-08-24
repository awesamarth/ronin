import { authorizeOrgRequest, permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = await authorizeOrgRequest(request, permissions.integrationsManage);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      channelId?: string;
      displayName?: string;
      repoId?: string;
      teamId?: string;
      accessMode?: string;
    };

    const platformChannelId = body.channelId?.trim();
    const repoId = body.repoId?.trim();
    const platformTeamId = body.teamId?.trim() || process.env.SLACK_TEAM_ID || "";
    const accessMode = body.accessMode === "external" ? "external" : "internal";
    if (accessMode === "external") {
      return NextResponse.json({ error: "External routes require an approved public-knowledge, tool-free execution profile." }, { status: 409 });
    }

    if (!platformChannelId || !repoId || !platformTeamId) {
      return NextResponse.json({ error: "channelId, repoId, and teamId are required." }, { status: 400 });
    }

    const repo = await prisma.repository.findFirst({
      include: { org: true },
      where: { id: repoId, orgId: auth.org.orgId },
    });

    if (!repo) {
      return NextResponse.json({ error: "Repository not found." }, { status: 404 });
    }

    const channel = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slack:${platformTeamId}`}))`;
      const installation = await tx.slackInstallation.findUnique({ where: { teamId: platformTeamId } });
      if (installation?.orgId && installation.orgId !== repo.orgId) {
        throw new SlackWorkspaceConflict("This Slack workspace is already connected to another Ronin organization.");
      }
      await tx.slackInstallation.upsert({
        where: { teamId: platformTeamId },
        create: { teamId: platformTeamId, orgId: repo.orgId },
        update: { orgId: repo.orgId, lastSeenAt: new Date() },
      });
      const mapped = await tx.channel.upsert({
        create: {
          accessMode,
          defaultRepoId: repo.id,
          displayName: body.displayName?.trim() || platformChannelId,
          orgId: repo.orgId,
          platform: "slack",
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
            platform: "slack",
            platformChannelId,
            platformTeamId,
          },
        },
      });
      await tx.channelRepository.deleteMany({ where: { channelId: mapped.id } });
      await tx.channelRepository.create({ data: { channelId: mapped.id, repoId: repo.id, orgId: repo.orgId } });
      await tx.auditLog.create({
        data: {
          action: "slack.channel_mapped",
          actorType: "user",
          actorId: auth.operator.session.id,
          metadata: JSON.stringify({
            channel: mapped.displayName,
            platformChannelId,
            platformTeamId,
            repo: repo.fullName,
            accessMode,
          }),
          orgId: repo.orgId,
          repoId: repo.id,
          target: platformChannelId,
        },
      });
      return mapped;
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
    return NextResponse.json({ error: message }, { status: error instanceof SlackWorkspaceConflict ? 409 : 500 });
  }
}

class SlackWorkspaceConflict extends Error {}

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
    if (!channel || channel.platform !== "slack") {
      return NextResponse.json({ error: "Slack route not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.channel.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          action: "slack.channel_unmapped",
          actorType: "user",
          actorId: auth.operator.session.id,
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
