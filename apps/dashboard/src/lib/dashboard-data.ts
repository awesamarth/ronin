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
  orgName: string;
  orgSlug: string;
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

export async function getLatestDashboardRun(): Promise<DashboardRun | null> {
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

export async function getWorkspaceOverview(): Promise<WorkspaceOverview | null> {
  const org = await prisma.org.findFirst({
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
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!org) return null;

  return {
    githubConnected: Boolean(org.githubInstallationId),
    githubInstallationId: org.githubInstallationId,
    orgName: org.name,
    orgSlug: org.slug,
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

export async function getActivityFeed(): Promise<ActivityEvent[]> {
  const logs = await prisma.auditLog.findMany({
    include: {
      repo: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 8,
    where: {
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

export async function getSlackConnection(): Promise<SlackConnection> {
  const teamId = process.env.SLACK_TEAM_ID ?? "";
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
    orderBy: {
      createdAt: "asc",
    },
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

export async function getTelegramConnection(): Promise<TelegramConnection> {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? "";
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
    orderBy: {
      createdAt: "asc",
    },
  });

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
