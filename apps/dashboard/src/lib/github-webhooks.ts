import { createHmac, timingSafeEqual } from "node:crypto";
import { processQueuedGithubRun } from "./github-run-processor";
import { prisma } from "./prisma";

type GitHubWebhookPayload = {
  action?: string;
  before?: string;
  after?: string;
  ref?: string;
  head_commit?: {
    id?: string;
    message?: string;
    url?: string;
  };
  installation?: {
    id?: number;
    account?: {
      id?: number;
      login?: string;
    };
  };
  organization?: {
    id?: number;
    login?: string;
  };
  repository?: {
    id?: number;
    full_name?: string;
    default_branch?: string;
    owner?: {
      id?: number;
      login?: string;
    };
  };
  pull_request?: {
    number?: number;
    title?: string;
    html_url?: string;
    head?: {
      sha?: string;
      ref?: string;
    };
    base?: {
      sha?: string;
      ref?: string;
    };
  };
  issue?: {
    number?: number;
    title?: string;
    html_url?: string;
  };
  comment?: {
    id?: number;
    body?: string;
    html_url?: string;
  };
  repositories?: Array<{
    id?: number;
    full_name?: string;
    default_branch?: string;
  }>;
  repositories_added?: Array<{
    id?: number;
    full_name?: string;
    default_branch?: string;
  }>;
  repositories_removed?: Array<{
    id?: number;
    full_name?: string;
    default_branch?: string;
  }>;
};

export async function handleGitHubWebhook(input: {
  deliveryId: string | null;
  eventName: string | null;
  signature256: string | null;
  rawBody: string;
}) {
  if (!input.deliveryId) return { status: 400, body: { error: "Missing X-GitHub-Delivery." } };
  if (!input.eventName) return { status: 400, body: { error: "Missing X-GitHub-Event." } };
  if (!verifyGitHubSignature(input.rawBody, input.signature256)) {
    return { status: 401, body: { error: "Invalid GitHub webhook signature." } };
  }

  const payload = JSON.parse(input.rawBody) as GitHubWebhookPayload;
  const org = await upsertOrgFromPayload(payload);
  const repo = await upsertRepositoryFromPayload(org.id, payload);

  const event = await prisma.gitHubEvent.upsert({
    where: { deliveryId: input.deliveryId },
    update: {
      orgId: org.id,
      repoId: repo?.id,
      eventName: input.eventName,
      action: payload.action,
      installationId: payload.installation?.id ? String(payload.installation.id) : undefined,
      payload: input.rawBody,
      processedAt: new Date(),
    },
    create: {
      orgId: org.id,
      repoId: repo?.id,
      deliveryId: input.deliveryId,
      eventName: input.eventName,
      action: payload.action,
      installationId: payload.installation?.id ? String(payload.installation.id) : undefined,
      payload: input.rawBody,
      processedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      repoId: repo?.id,
      actorType: "github",
      actorId: payload.installation?.id ? String(payload.installation.id) : undefined,
      action: `github.${input.eventName}`,
      target: repo?.fullName ?? org.githubOrgLogin ?? org.slug,
      metadata: JSON.stringify({
        deliveryId: input.deliveryId,
        action: payload.action,
      }),
    },
  });

  if (input.eventName === "installation_repositories") {
    await upsertInstallationRepositories(org.id, payload, {
      action: payload.action,
      deliveryId: input.deliveryId,
      installationId: payload.installation?.id ? String(payload.installation.id) : undefined,
    });
  }

  const run = await createRunForWebhook({
    action: payload.action,
    deliveryId: input.deliveryId,
    eventName: input.eventName,
    orgId: org.id,
    payload,
    repoId: repo?.id,
    repoName: repo?.fullName,
  });
  const processing = await maybeProcessWebhookRun({
    eventName: input.eventName,
    runId: run?.id,
  });

  return {
    status: processing?.status === "processed" ? 200 : 202,
    body: {
      ok: true,
      eventId: event.id,
      runId: run?.id,
      processing,
      eventName: input.eventName,
      action: payload.action,
      org: org.slug,
      repo: repo?.fullName,
    },
  };
}

async function maybeProcessWebhookRun(input: { eventName: string; runId?: string }) {
  if (!input.runId) return null;
  const run = await prisma.run.findUnique({
    select: {
      status: true,
    },
    where: {
      id: input.runId,
    },
  });
  if (run?.status === "running" || run?.status === "completed") {
    return { status: "skipped" as const, reason: `run is already ${run.status}` };
  }
  if (process.env.GITHUB_WEBHOOK_AUTO_PROCESS !== "true") {
    return { status: "queued" as const, reason: "queued for GitHub worker" };
  }
  if (input.eventName !== "push" && input.eventName !== "pull_request") {
    return { status: "queued" as const, reason: `${input.eventName} auto-processing is not implemented yet` };
  }

  try {
    const processedRun = await processQueuedGithubRun(input.runId);
    return {
      status: "processed" as const,
      runId: processedRun?.id,
      runStatus: processedRun?.status,
    };
  } catch (error) {
    return {
      status: "failed" as const,
      error: error instanceof Error ? error.message : "GitHub run auto-processing failed.",
    };
  }
}

async function createRunForWebhook(input: {
  action?: string;
  deliveryId: string;
  eventName: string;
  orgId: string;
  payload: GitHubWebhookPayload;
  repoId?: string;
  repoName?: string;
}) {
  if (!input.repoId) return null;

  const kind = webhookRunKind(input.eventName);
  if (!kind) return null;
  if (isRoninAuthoredWebhook(input.eventName, input.payload)) return null;

  if (input.eventName === "push" && input.payload.after && input.repoId) {
    await prisma.repository.update({
      where: { id: input.repoId },
      data: { latestKnownSha: input.payload.after },
    });
  }

  const id = `github-${input.eventName}-${input.deliveryId}`;
  const summary = webhookRunSummary(input);
  const runInput = buildWebhookRunInput(input);
  const existingRun = await prisma.run.findUnique({
    where: { id },
  });

  if (existingRun?.status === "running" || existingRun?.status === "completed") {
    return existingRun;
  }

  const run = await prisma.run.upsert({
    where: { id },
    update: {
      kind,
      repoId: input.repoId,
      status: "queued",
      summary,
      input: JSON.stringify(runInput),
      output: null,
      completedAt: null,
    },
    create: {
      id,
      orgId: input.orgId,
      repoId: input.repoId,
      kind,
      status: "queued",
      summary,
      input: JSON.stringify(runInput),
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: input.orgId,
      repoId: input.repoId,
      runId: run.id,
      actorType: "github",
      actorId: input.payload.installation?.id ? String(input.payload.installation.id) : undefined,
      action: "run.queued",
      target: input.repoName,
      metadata: JSON.stringify({
        deliveryId: input.deliveryId,
        eventName: input.eventName,
        action: input.action,
        kind,
      }),
    },
  });

  return run;
}

function webhookRunKind(eventName: string) {
  if (eventName === "push") return "github.push";
  if (eventName === "pull_request") return "github.pull_request";
  if (eventName === "issue_comment") return "github.issue_comment";
  if (eventName === "pull_request_review_comment") return "github.pr_review_comment";
  return null;
}

function webhookRunSummary(input: {
  action?: string;
  eventName: string;
  payload: GitHubWebhookPayload;
  repoName?: string;
}) {
  const repo = input.repoName ?? "repository";

  if (input.eventName === "push") {
    const branch = input.payload.ref?.replace("refs/heads/", "") ?? "unknown branch";
    const shortSha = input.payload.after?.slice(0, 7) ?? "unknown sha";
    return `Push received on ${repo}:${branch} at ${shortSha}. Ronin should compare the diff and update docs/knowledge.`;
  }

  if (input.eventName === "pull_request") {
    const number = input.payload.pull_request?.number;
    const title = input.payload.pull_request?.title;
    return `Pull request ${input.action ?? "event"} received for ${repo}${number ? ` #${number}` : ""}${title ? `: ${title}` : ""}.`;
  }

  if (input.eventName === "issue_comment" || input.eventName === "pull_request_review_comment") {
    return `Comment received on ${repo}. Ronin should map it to repo context and decide whether the agent needs to answer or act.`;
  }

  return `${input.eventName} received for ${repo}.`;
}

function buildWebhookRunInput(input: {
  action?: string;
  deliveryId: string;
  eventName: string;
  payload: GitHubWebhookPayload;
  repoName?: string;
}) {
  return {
    source: "github_app_webhook",
    deliveryId: input.deliveryId,
    eventName: input.eventName,
    action: input.action,
    repo: input.repoName,
    installationId: input.payload.installation?.id ? String(input.payload.installation.id) : undefined,
    push:
      input.eventName === "push"
        ? {
            before: input.payload.before,
            after: input.payload.after,
            ref: input.payload.ref,
            headCommit: input.payload.head_commit,
          }
        : undefined,
    pullRequest: input.payload.pull_request
      ? {
          number: input.payload.pull_request.number,
          title: input.payload.pull_request.title,
          url: input.payload.pull_request.html_url,
          head: input.payload.pull_request.head,
          base: input.payload.pull_request.base,
        }
      : undefined,
    issue: input.payload.issue
      ? {
          number: input.payload.issue.number,
          title: input.payload.issue.title,
          url: input.payload.issue.html_url,
        }
      : undefined,
    comment: input.payload.comment
      ? {
          id: input.payload.comment.id,
          url: input.payload.comment.html_url,
          bodyPreview: input.payload.comment.body?.slice(0, 500),
        }
      : undefined,
  };
}

function isRoninAuthoredWebhook(eventName: string, payload: GitHubWebhookPayload) {
  if (eventName === "push") {
    const branch = payload.ref?.replace("refs/heads/", "");
    return branch?.startsWith("ronin/") ?? false;
  }

  if (eventName === "pull_request") {
    return payload.pull_request?.head?.ref?.startsWith("ronin/") ?? false;
  }

  return false;
}

function verifyGitHubSignature(rawBody: string, signature256: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signature256?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature256);

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

async function upsertOrgFromPayload(payload: GitHubWebhookPayload) {
  const installationId = payload.installation?.id ? String(payload.installation.id) : undefined;
  const account = payload.organization ?? payload.installation?.account ?? payload.repository?.owner;
  const githubOrgLogin = account?.login ?? "unknown-github-account";
  const githubOrgId = account?.id ? String(account.id) : undefined;
  const slug = githubOrgLogin.toLowerCase();

  if (installationId) {
    const existingOrg =
      (await prisma.org.findUnique({ where: { githubInstallationId: installationId } })) ??
      (await prisma.org.findUnique({ where: { githubOrgLogin } })) ??
      (await prisma.org.findUnique({ where: { slug } }));

    if (existingOrg) {
      return prisma.org.update({
        where: { id: existingOrg.id },
        data: {
          githubInstallationId: installationId,
          githubOrgId,
          githubOrgLogin,
          name: githubOrgLogin,
          slug,
        },
      });
    }

    return prisma.org.create({
      data: {
        githubInstallationId: installationId,
        githubOrgId,
        githubOrgLogin,
        name: githubOrgLogin,
        slug,
      },
    });
  }

  return prisma.org.upsert({
    where: { slug },
    update: {
      githubOrgId,
      githubOrgLogin,
      name: githubOrgLogin,
    },
    create: {
      githubOrgId,
      githubOrgLogin,
      name: githubOrgLogin,
      slug,
    },
  });
}

async function upsertRepositoryFromPayload(orgId: string, payload: GitHubWebhookPayload) {
  if (!payload.repository?.full_name) return null;

  return prisma.repository.upsert({
    where: {
      orgId_fullName: {
        orgId,
        fullName: payload.repository.full_name,
      },
    },
    update: {
      githubRepoId: payload.repository.id ? String(payload.repository.id) : undefined,
      defaultBranch: payload.repository.default_branch ?? "main",
      watchedEnabled: true,
      capabilities: "docs,pr_review,support_answers,try_fix,auto_report_pr",
    },
    create: {
      orgId,
      githubRepoId: payload.repository.id ? String(payload.repository.id) : undefined,
      fullName: payload.repository.full_name,
      defaultBranch: payload.repository.default_branch ?? "main",
      watchedEnabled: true,
      capabilities: "docs,pr_review,support_answers,try_fix,auto_report_pr",
    },
  });
}

async function upsertInstallationRepositories(
  orgId: string,
  payload: GitHubWebhookPayload,
  input: { action?: string; deliveryId: string; installationId?: string },
) {
  const onboardingRuns: Array<{ id: string }> = [];
  const repos = input.action === "added" ? (payload.repositories_added ?? payload.repositories ?? []) : (payload.repositories ?? []);
  for (const repo of repos) {
    if (!repo.full_name) continue;

    const repository = await prisma.repository.upsert({
      where: {
        orgId_fullName: {
          orgId,
          fullName: repo.full_name,
        },
      },
      update: {
        githubRepoId: repo.id ? String(repo.id) : undefined,
        defaultBranch: repo.default_branch ?? "main",
        watchedEnabled: true,
        capabilities: "docs,pr_review,support_answers,try_fix,auto_report_pr",
      },
      create: {
        orgId,
        githubRepoId: repo.id ? String(repo.id) : undefined,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? "main",
        watchedEnabled: true,
        capabilities: "docs,pr_review,support_answers,try_fix,auto_report_pr",
      },
    });

    const existingOnboardingRun = await prisma.run.findFirst({
      where: {
        kind: "github.repository_onboarded",
        repoId: repository.id,
      },
    });
    const shouldOnboard = input.action === "added" && !existingOnboardingRun;
    if (!shouldOnboard) continue;

    const run = await prisma.run.create({
      data: {
        id: `github-repository-onboarded-${Date.now()}-${String(repo.id ?? repo.full_name)}`,
        orgId,
        repoId: repository.id,
        kind: "github.repository_onboarded",
        status: "queued",
        input: JSON.stringify({
          source: "github.installation_repositories_webhook",
          deliveryId: input.deliveryId,
          eventName: "repository_onboarded",
          action: input.action,
          installationId: input.installationId,
          repo: repo.full_name,
        }),
        summary: `Repository ${repo.full_name} was added to Ronin through the GitHub App. Ronin should inspect the repo and propose useful docs, changelog, example, or support-knowledge updates.`,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        repoId: repository.id,
        runId: run.id,
        actorType: "github",
        actorId: input.installationId,
        action: "run.queued",
        target: repo.full_name,
        metadata: JSON.stringify({
          deliveryId: input.deliveryId,
          eventName: "installation_repositories",
          action: input.action,
          kind: "github.repository_onboarded",
        }),
      },
    });

    onboardingRuns.push(run);
  }

  return onboardingRuns;
}
