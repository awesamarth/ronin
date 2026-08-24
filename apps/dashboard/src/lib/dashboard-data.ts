import { prisma } from "./prisma";

export type DashboardRun = {
  id: string;
  kind: string;
  status: string;
  summary: string;
  repo: string;
  createdAt: string;
  input: {
    eventName?: string;
    action?: string;
    deliveryId?: string;
    platform?: string;
    channelName?: string;
    push?: {
      before?: string;
      after?: string;
      ref?: string;
    };
    pullRequest?: {
      number?: number;
      title?: string;
      url?: string;
    };
  };
  artifacts: Array<{
    createdAt: string;
    kind: string;
    title: string;
    content: string;
  }>;
};

export type ActivityEvent = {
  id: string;
  action: string;
  actorType: string;
  createdAt: string;
  repo: string | null;
  runId: string | null;
  target: string | null;
  metadata: Record<string, unknown>;
};

export type WorkspaceOverview = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  profile: string | null;
  githubConnected: boolean;
  githubInstallationId: string | null;
  repos: Array<{
    id: string;
    fullName: string;
    capabilities: string[];
    latestKnownSha: string | null;
    watchedEnabled: boolean;
    harnessType: string;
    model: string | null;
    provider: string | null;
    reasoning: string | null;
  }>;
};

export type SlackConnection = {
  botUserId: string | null;
  configured: boolean;
  teamId: string;
  channels: Array<{
    id: string;
    displayName: string;
    platformChannelId: string;
    repo: string | null;
  }>;
  repos: Array<{
    id: string;
    fullName: string;
  }>;
};

export type OrgMember = {
  userId: string;
  displayName: string;
  identity: string;
  role: string;
  status: string;
};

export type TelegramConnection = {
  botUsername: string;
  configured: boolean;
  chats: Array<{
    id: string;
    displayName: string;
    platformChannelId: string;
    repo: string | null;
  }>;
  repos: Array<{
    id: string;
    fullName: string;
  }>;
};

export async function getOrgMembers(orgId?: string): Promise<OrgMember[]> {
  if (!orgId) return [];
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId },
    include: { user: { include: { identities: { orderBy: { createdAt: "asc" }, take: 1 } } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((membership) => ({
    userId: membership.userId,
    displayName: membership.user.displayName ?? membership.user.identities[0]?.login ?? "Unknown user",
    identity: membership.user.identities[0]
      ? `${membership.user.identities[0].provider}:${membership.user.identities[0].login ?? membership.user.identities[0].providerAccountId}`
      : "No identity",
    role: membership.role,
    status: membership.status,
  }));
}

export async function getLatestDashboardRun(orgId?: string): Promise<DashboardRun | null> {
  if (!orgId) return null;
  const run = await prisma.run.findFirst({
    include: {
      artifacts: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      repo: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    where: {
      orgId,
      OR: [{ kind: { startsWith: "github." } }, { kind: "message.workspace_request" }],
    },
  });

  if (!run) return null;

  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    summary: run.summary ?? "Run queued.",
    repo: run.repo?.fullName ?? "unknown repo",
    createdAt: run.createdAt.toISOString(),
    input: parseRunInput(run.input),
    artifacts: run.artifacts.map((artifact) => ({
      createdAt: artifact.createdAt.toISOString(),
      kind: artifact.kind,
      title: artifact.title,
      content: artifact.content,
    })),
  };
}

export async function getWorkspaceOverview(orgId?: string): Promise<WorkspaceOverview | null> {
  if (!orgId) return null;
  const org = await prisma.org.findUnique({
    include: {
      repos: {
        orderBy: {
          createdAt: "asc",
        },
        where: {
          watchedEnabled: true,
        },
      },
    },
    where: { id: orgId },
  });

  if (!org) return null;

  return {
    githubConnected: Boolean(org.githubInstallationId),
    githubInstallationId: org.githubInstallationId,
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    profile: org.profile,
    repos: org.repos.map((repo) => ({
      capabilities: repo.capabilities.split(",").map((capability) => capability.trim()).filter(Boolean),
      fullName: repo.fullName,
      id: repo.id,
      latestKnownSha: repo.latestKnownSha,
      watchedEnabled: repo.watchedEnabled,
      harnessType: repo.harnessType,
      model: repo.model,
      provider: repo.provider,
      reasoning: repo.reasoning,
    })),
  };
}

export async function getActivityFeed(orgId?: string): Promise<ActivityEvent[]> {
  if (!orgId) return [];
  const logs = await prisma.auditLog.findMany({
    include: {
      repo: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 8,
    where: {
      orgId,
      action: {
        in: [
          "github.push",
          "github.pull_request",
          "run.queued",
          "run.completed",
          "run.blocked",
          "github.pull_request_opened",
          "github.pull_request_failed",
        ],
      },
    },
  });

  return logs.map((log) => ({
    action: log.action,
    actorType: log.actorType,
    createdAt: log.createdAt.toISOString(),
    id: log.id,
    metadata: parseMetadata(log.metadata),
    repo: log.repo?.fullName ?? null,
    runId: log.runId,
    target: log.target,
  }));
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getSlackConnection(orgId?: string): Promise<SlackConnection> {
  const teamId = process.env.SLACK_TEAM_ID ?? "";
  const installation = teamId ? await prisma.slackInstallation.findUnique({ where: { teamId }, select: { orgId: true } }) : null;
  const org = await prisma.org.findFirst({
    include: {
      channels: {
        include: {
          defaultRepo: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          platform: "slack",
          platformTeamId: teamId,
        },
      },
      repos: {
        orderBy: {
          createdAt: "asc",
        },
        where: {
          watchedEnabled: true,
        },
      },
    },
    where: orgId && installation?.orgId === orgId ? { id: orgId } : { id: "__unavailable__" },
  });

  return {
    botUserId: process.env.SLACK_BOT_USER_ID ?? null,
    configured: Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN && teamId),
    teamId,
    channels:
      org?.channels.map((channel) => ({
        id: channel.id,
        displayName: channel.displayName ?? channel.platformChannelId,
        platformChannelId: channel.platformChannelId,
        repo: channel.defaultRepo?.fullName ?? null,
      })) ?? [],
    repos:
      org?.repos.map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
      })) ?? [],
  };
}

export async function getTelegramConnection(orgId?: string): Promise<TelegramConnection> {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? "";
  const org = orgId ? await prisma.org.findUnique({
    include: {
      channels: {
        include: {
          defaultRepo: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        where: {
          platform: "telegram",
          platformTeamId: botUsername,
        },
      },
      repos: {
        orderBy: {
          createdAt: "asc",
        },
        where: {
          watchedEnabled: true,
        },
      },
    },
    where: { id: orgId },
  }) : null;

  return {
    botUsername,
    chats:
      org?.channels.map((channel) => ({
        id: channel.id,
        displayName: channel.displayName ?? channel.platformChannelId,
        platformChannelId: channel.platformChannelId,
        repo: channel.defaultRepo?.fullName ?? null,
      })) ?? [],
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    repos:
      org?.repos.map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
      })) ?? [],
  };
}

function parseRunInput(input: string): DashboardRun["input"] {
  try {
    const parsed = JSON.parse(input) as DashboardRun["input"];
    return parsed;
  } catch {
    return {};
  }
}
