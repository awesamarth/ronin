import { prisma } from "./prisma";
import { createInstallationToken } from "./github-app";
import { runCentaurTask, buildThreadKey } from "./centaur-client";
import { openPullRequestForGithubRun } from "./github-pr";
import { runGithubWorkspaceMaintenance } from "./github-workspace-runner";

type QueuedRunInput = {
  source?: string;
  deliveryId?: string;
  eventName?: string;
  action?: string;
  repo?: string;
  installationId?: string;
  push?: {
    before?: string;
    after?: string;
    ref?: string;
    headCommit?: {
      id?: string;
      message?: string;
      url?: string;
    };
  };
  pullRequest?: {
    number?: number;
    title?: string;
    url?: string;
    head?: {
      sha?: string;
      ref?: string;
    };
    base?: {
      sha?: string;
      ref?: string;
    };
  };
};

type CompareResponse = {
  html_url?: string;
  status?: string;
  ahead_by?: number;
  behind_by?: number;
  total_commits?: number;
  files?: Array<{
    filename: string;
    status?: string;
    additions?: number;
    deletions?: number;
    changes?: number;
    patch?: string;
  }>;
  commits?: Array<{
    sha: string;
    commit?: {
      message?: string;
    };
    html_url?: string;
  }>;
};

const staleRunningMs = () => Number(process.env.RONIN_GITHUB_WORKER_STALE_RUNNING_MS ?? 900_000);

export async function processLatestQueuedGithubRun() {
  const [claimed] = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidate AS (
      SELECT id FROM "Run"
      WHERE kind LIKE 'github.%'
        AND (
          status = 'queued'
          OR (status = 'running' AND "startedAt" < NOW() - (${staleRunningMs()} * INTERVAL '1 millisecond'))
        )
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "Run" AS run
    SET status = 'running', "startedAt" = NOW(), "completedAt" = NULL, attempt = attempt + 1
    FROM candidate
    WHERE run.id = candidate.id
    RETURNING run.id
  `;
  return claimed ? processClaimedGithubRun(claimed.id) : null;
}

export async function processQueuedGithubRun(runId: string) {
  const staleBefore = new Date(Date.now() - staleRunningMs());
  const claimed = await prisma.run.updateMany({
    where: {
      id: runId,
      kind: { startsWith: "github." },
      OR: [{ status: "queued" }, { status: "running", startedAt: { lt: staleBefore } }],
    },
    data: { status: "running", startedAt: new Date(), completedAt: null, attempt: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new Error(`Run ${runId} is not queued or stale.`);
  return processClaimedGithubRun(runId);
}

async function processClaimedGithubRun(runId: string) {
  const run = await prisma.run.findUnique({
    include: { org: true, repo: true },
    where: { id: runId },
  });
  if (!run) throw new Error(`Run ${runId} was not found.`);
  if (!run.repo) throw new Error(`Run ${runId} is not linked to a repository.`);

  try {
    const input = parseRunInput(run.input);
    if (input.eventName === "repository_onboarded") {
      return await processRepositoryOnboardingRun({ input, run });
    }

    const compare = await fetchCompareForRun(input, run.repo.fullName);
    const prompt = buildProcessingPrompt({
      compare,
      input,
      kind: run.kind,
      repo: run.repo.fullName,
      summary: run.summary,
    });
    const agent = await runCentaurTask({
      threadKey: buildThreadKey(["run", run.repo.fullName, run.id]),
      prompt,
      idempotencyKey: `${run.id}:analyze`,
      config: {
        harness: run.repo.harnessType,
        model: run.repo.model,
        provider: run.repo.provider,
        reasoning: run.repo.reasoning,
      },
      onExecutionStarted: ({ executionId, threadKey }) =>
        prisma.run.update({
          where: { id: run.id },
          data: { centaurExecutionId: executionId, centaurThreadKey: threadKey },
        }),
    });
    const parsed = parseAgentJson(agent.rawOutput);
    const artifacts = {
      docsUpdatePlan: stringOrFallback(parsed.docsUpdatePlan, "Agent did not return a docs update plan."),
      changelogDraft: stringOrFallback(parsed.changelogDraft, "Agent did not return a changelog draft."),
      knownIssuesUpdate: stringOrFallback(parsed.knownIssuesUpdate, "Agent did not return known-issues updates."),
      supportAnswerDelta: stringOrFallback(parsed.supportAnswerDelta, "Agent did not return a support-answer delta."),
      suggestedPrBody: stringOrFallback(parsed.suggestedPrBody, "Agent did not return a PR body."),
      runnerBackend: agent.backend,
    };
    const workspaceResult = shouldRunWorkspaceMaintenance(run.kind, run.repo.capabilities, parsed.suggestedPrBody, artifacts.changelogDraft)
      ? await runGithubWorkspaceMaintenance({
          afterSha: input.push?.after ?? input.pullRequest?.head?.sha,
          baseBranch: run.repo.defaultBranch || "main",
          beforeSha: input.push?.before ?? input.pullRequest?.base?.sha,
          changelogDraft: artifacts.changelogDraft,
          eventName: input.eventName,
          executionConfig: {
            harness: run.repo.harnessType,
            model: run.repo.model,
            provider: run.repo.provider,
            reasoning: run.repo.reasoning,
          },
          prompt,
          repo: run.repo.fullName,
          runId: run.id,
        })
      : null;

    await prisma.$transaction([
      prisma.artifact.create({
        data: {
          orgId: run.orgId,
          repoId: run.repoId,
          runId: run.id,
          kind: "docs_update_plan",
          title: "Docs Update Plan",
          content: artifacts.docsUpdatePlan,
        },
      }),
      prisma.artifact.create({
        data: {
          orgId: run.orgId,
          repoId: run.repoId,
          runId: run.id,
          kind: "changelog_draft",
          title: "Changelog Draft",
          content: artifacts.changelogDraft,
        },
      }),
      prisma.artifact.create({
        data: {
          orgId: run.orgId,
          repoId: run.repoId,
          runId: run.id,
          kind: "known_issues_update",
          title: "Known Issues Update",
          content: artifacts.knownIssuesUpdate,
        },
      }),
      prisma.artifact.create({
        data: {
          orgId: run.orgId,
          repoId: run.repoId,
          runId: run.id,
          kind: "suggested_pr_body",
          title: "Suggested PR Body",
          content: artifacts.suggestedPrBody,
        },
      }),
      ...(workspaceResult
        ? [
            prisma.artifact.create({
              data: {
                orgId: run.orgId,
                repoId: run.repoId,
                runId: run.id,
                kind: "github_workspace_patch",
                title: workspaceResult.pushed ? "Workspace Patch" : "Workspace Inspection",
                content: JSON.stringify({
                  branch: workspaceResult.branch,
                  changedFiles: workspaceResult.changedFiles,
                  commitSha: workspaceResult.commitSha,
                  diffPreview: workspaceResult.diff.slice(0, 8000),
                  prBody: workspaceResult.prBody,
                  prTitle: workspaceResult.prTitle,
                  pushed: workspaceResult.pushed,
                  testLog: workspaceResult.testLog,
                }),
              },
            }),
          ]
        : []),
      prisma.run.update({
        where: { id: run.id },
        data: {
          status: "completed",
          summary: workspaceResult?.pushed
            ? `Ronin committed ${workspaceResult.changedFiles.length} file change${workspaceResult.changedFiles.length === 1 ? "" : "s"} for ${run.repo.fullName}.`
            : stringOrFallback(parsed.summary, run.summary ?? "GitHub run processed."),
          output: JSON.stringify({
            artifacts,
            compare: summarizeCompare(compare),
            workspace: workspaceResult
              ? {
                  branch: workspaceResult.branch,
                  changedFiles: workspaceResult.changedFiles,
                  commitSha: workspaceResult.commitSha,
                  pushed: workspaceResult.pushed,
                  testLog: workspaceResult.testLog,
                }
              : null,
          }),
          completedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          orgId: run.orgId,
          repoId: run.repoId,
          runId: run.id,
          actorType: "ronin",
          action: "run.completed",
          target: run.repo.fullName,
          metadata: JSON.stringify({ runnerBackend: agent.backend }),
        },
      }),
    ]);

    if (workspaceResult?.pushed || shouldAutoOpenPullRequest(run.kind, run.repo.capabilities, parsed.suggestedPrBody)) {
      try {
        await openPullRequestForGithubRun(run.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Auto PR creation failed.";
        await prisma.artifact.create({
          data: {
            orgId: run.orgId,
            repoId: run.repoId,
            runId: run.id,
            kind: "github_pr_error",
            title: "GitHub PR Error",
            content: message,
          },
        });
        await prisma.auditLog.create({
          data: {
            orgId: run.orgId,
            repoId: run.repoId,
            runId: run.id,
            actorType: "github_app",
            action: "github.pull_request_failed",
            target: run.repo.fullName,
            metadata: JSON.stringify({ error: message }),
          },
        });
      }
    }

    return prisma.run.findUnique({
      include: {
        artifacts: {
          orderBy: { createdAt: "desc" },
        },
        repo: true,
      },
      where: { id: run.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run processing failed.";
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: "blocked",
        output: JSON.stringify({ error: message }),
        completedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: run.orgId,
        repoId: run.repoId,
        runId: run.id,
        actorType: "ronin",
        action: "run.blocked",
        target: run.repo.fullName,
        metadata: JSON.stringify({ error: message }),
      },
    });
    throw error;
  }
}

async function processRepositoryOnboardingRun(input: {
  input: QueuedRunInput;
  run: {
    id: string;
    kind: string;
    orgId: string;
    repoId: string | null;
    summary: string | null;
    org: { githubInstallationId: string | null };
    repo: {
      capabilities: string;
      defaultBranch: string;
      fullName: string;
      harnessType: string;
      model: string | null;
      provider: string | null;
      reasoning: string | null;
    } | null;
  };
}) {
  const { run } = input;
  if (!run.repo) throw new Error(`Run ${run.id} is not linked to a repository.`);
  const installationId = input.input.installationId ?? run.org.githubInstallationId;
  if (!installationId) throw new Error("GitHub installation id is missing from onboarding run input.");

  const prompt = buildRepositoryOnboardingPrompt({
    repo: run.repo.fullName,
    runId: run.id,
  });
  const workspaceResult = await runGithubWorkspaceMaintenance({
    baseBranch: run.repo.defaultBranch || "main",
    eventName: "repository_onboarded",
    executionConfig: {
      harness: run.repo.harnessType,
      model: run.repo.model,
      provider: run.repo.provider,
      reasoning: run.repo.reasoning,
    },
    prompt,
    repo: run.repo.fullName,
    runId: run.id,
  });

  await prisma.$transaction([
    prisma.artifact.create({
      data: {
        orgId: run.orgId,
        repoId: run.repoId,
        runId: run.id,
        kind: "repo_onboarding_report",
        title: "Repository Onboarding Report",
        content: workspaceResult.prBody,
      },
    }),
    prisma.artifact.create({
      data: {
        orgId: run.orgId,
        repoId: run.repoId,
        runId: run.id,
        kind: "github_workspace_patch",
        title: workspaceResult.pushed ? "Workspace Patch" : "Workspace Inspection",
        content: JSON.stringify({
          branch: workspaceResult.branch,
          changedFiles: workspaceResult.changedFiles,
          commitSha: workspaceResult.commitSha,
          diffPreview: workspaceResult.diff.slice(0, 8000),
          prBody: workspaceResult.prBody,
          prTitle: workspaceResult.prTitle,
          pushed: workspaceResult.pushed,
          testLog: workspaceResult.testLog,
        }),
      },
    }),
    prisma.run.update({
      where: { id: run.id },
      data: {
        status: "completed",
        summary: workspaceResult.pushed
          ? `Ronin onboarded ${run.repo.fullName} and committed ${workspaceResult.changedFiles.length} file change${workspaceResult.changedFiles.length === 1 ? "" : "s"}.`
          : `Ronin inspected ${run.repo.fullName}; no useful onboarding patch was produced.`,
        output: JSON.stringify({
          workspace: {
            branch: workspaceResult.branch,
            changedFiles: workspaceResult.changedFiles,
            commitSha: workspaceResult.commitSha,
            pushed: workspaceResult.pushed,
            testLog: workspaceResult.testLog,
          },
        }),
        completedAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        orgId: run.orgId,
        repoId: run.repoId,
        runId: run.id,
        actorType: "ronin",
        action: "run.completed",
        target: run.repo.fullName,
        metadata: JSON.stringify({ eventName: "repository_onboarded", pushed: workspaceResult.pushed }),
      },
    }),
  ]);

  if (workspaceResult.pushed) {
    try {
      await openPullRequestForGithubRun(run.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auto PR creation failed.";
      await prisma.artifact.create({
        data: {
          orgId: run.orgId,
          repoId: run.repoId,
          runId: run.id,
          kind: "github_pr_error",
          title: "GitHub PR Error",
          content: message,
        },
      });
      await prisma.auditLog.create({
        data: {
          orgId: run.orgId,
          repoId: run.repoId,
          runId: run.id,
          actorType: "github_app",
          action: "github.pull_request_failed",
          target: run.repo.fullName,
          metadata: JSON.stringify({ error: message }),
        },
      });
    }
  }

  return prisma.run.findUnique({
    include: {
      artifacts: {
        orderBy: { createdAt: "desc" },
      },
      repo: true,
    },
    where: { id: run.id },
  });
}

function shouldAutoOpenPullRequest(kind: string, capabilities: string, suggestedPrBody: unknown) {
  if (kind !== "github.push") return false;
  if (!capabilities.split(",").map((capability) => capability.trim()).includes("auto_report_pr")) return false;
  const body = typeof suggestedPrBody === "string" ? suggestedPrBody.toLowerCase() : "";
  return !body.includes("no pr needed");
}

function shouldRunWorkspaceMaintenance(kind: string, capabilities: string, suggestedPrBody: unknown, changelogDraft: string) {
  if (kind !== "github.push") return false;
  const capabilitySet = capabilities.split(",").map((capability) => capability.trim());
  if (!capabilitySet.includes("auto_report_pr")) return false;
  // Conservative AND: a declared no-PR OR no-changelog result must not trigger
  // workspace mutation.
  const body = typeof suggestedPrBody === "string" ? suggestedPrBody.toLowerCase() : "";
  if (body.includes("no pr needed")) return false;
  return !changelogDraft.toLowerCase().includes("no changelog");
}

async function fetchCompareForRun(input: QueuedRunInput, repo: string) {
  const installationId = input.installationId;
  if (!installationId) throw new Error("GitHub installation id is missing from run input.");

  if (input.eventName === "push") {
    const before = input.push?.before;
    const after = input.push?.after;
    if (!before || !after) throw new Error("Push run input is missing before/after SHAs.");
    return fetchGitHubCompare({ after, before, installationId, repo });
  }

  if (input.eventName === "pull_request") {
    const before = input.pullRequest?.base?.sha;
    const after = input.pullRequest?.head?.sha;
    if (!before || !after) throw new Error("Pull request run input is missing base/head SHAs.");
    return fetchGitHubCompare({ after, before, installationId, repo });
  }

  throw new Error(`Run event ${input.eventName ?? "unknown"} does not have a diff processor yet.`);
}

async function fetchGitHubCompare(input: { after: string; before: string; installationId: string; repo: string }) {
  const { token } = await createInstallationToken(input.installationId);
  const response = await fetch(`https://api.github.com/repos/${input.repo}/compare/${input.before}...${input.after}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub compare for ${input.repo}: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as CompareResponse;
}

function buildProcessingPrompt(input: {
  compare: CompareResponse;
  input: QueuedRunInput;
  kind: string;
  repo: string;
  summary: string | null;
}) {
  const files = input.compare.files ?? [];
  const commits = input.compare.commits ?? [];

  return `You are Ronin, an agentic solutions engineering system for protocol teams.

Process this GitHub event and produce concrete maintenance artifacts.

Rules:
- Be specific to this repo and diff.
- Focus on docs drift, integration impact, support FAQ changes, changelog notes, and whether a follow-up PR is needed.
- Do not claim tests passed unless the diff evidence says so.
- Return ONLY valid JSON. No markdown fences. No prose outside JSON.

Run:
- Kind: ${input.kind}
- Repo: ${input.repo}
- Event: ${input.input.eventName ?? "unknown"}
- Action: ${input.input.action ?? "none"}
- Summary: ${input.summary ?? "none"}

Compare:
- URL: ${input.compare.html_url ?? "unknown"}
- Status: ${input.compare.status ?? "unknown"}
- Commits: ${input.compare.total_commits ?? commits.length}
- Files changed: ${files.length}

Commits:
${commits.slice(0, 20).map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.commit?.message ?? ""}`).join("\n")}

Changed files:
${files
  .slice(0, 30)
  .map((file) => {
    const patch = file.patch ? `\n${file.patch.slice(0, 3000)}` : "";
    return `- ${file.filename} (${file.status ?? "changed"}, +${file.additions ?? 0}/-${file.deletions ?? 0})${patch}`;
  })
  .join("\n\n")}

Return JSON with this exact shape:
{
  "summary": "1-2 sentence result of processing this event",
  "docsUpdatePlan": "Markdown list of docs that should be updated and why",
  "changelogDraft": "Markdown changelog entry for this change",
  "knownIssuesUpdate": "Markdown known-issues/FAQ update, or say no update needed",
  "supportAnswerDelta": "Short support answer delta Telegram/Slack bots should learn",
  "suggestedPrBody": "Markdown body for a follow-up docs/integration PR, or say no PR needed"
}`;
}

function buildRepositoryOnboardingPrompt(input: { repo: string; runId: string }) {
  return `Use the Ronin skill.

You are onboarding a newly watched repository into Ronin.

Repo: ${input.repo}
Run: ${input.runId}

Inspect the checked-out repository and make useful first-pass maintenance changes directly in the working tree.

Priorities:
- If there is no CHANGELOG.md, create one with an initial entry describing the current SDK/app surface.
- Improve README usage docs when they are incomplete or still template-like.
- Add minimal docs/examples only when they clearly fit the existing repo.
- Do not make noisy formatting-only changes.
- Do not push, merge, deploy, or spend money.
- Run lightweight checks when obvious.

When finished, return ONLY JSON:
{
  "summary": "what you changed",
  "changedFiles": ["file.md"],
  "commandsRun": ["bun run build"],
  "tests": "test results or why not run",
  "prTitle": "Ronin: onboard repository docs",
  "prBody": "Markdown PR body with summary, changed files, and checks"
}`;
}

function parseRunInput(input: string): QueuedRunInput {
  try {
    return JSON.parse(input) as QueuedRunInput;
  } catch {
    throw new Error("Run input is not valid JSON.");
  }
}

function parseAgentJson(rawOutput: string): Record<string, unknown> {
  try {
    return JSON.parse(rawOutput) as Record<string, unknown>;
  } catch {
    const match = rawOutput.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Agent did not return JSON.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function summarizeCompare(compare: CompareResponse) {
  return {
    url: compare.html_url,
    status: compare.status,
    commits: compare.total_commits ?? compare.commits?.length ?? 0,
    files: compare.files?.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
    })),
  };
}
