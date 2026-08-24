import { prisma } from "./prisma";
import { buildThreadKey } from "./centaur-client";
import { recordInboundMessage } from "./conversations";
import { runTrackedCentaurTask } from "./tracked-centaur";
import { openPullRequestForGithubRun } from "./github-pr";
import { runGithubWorkspaceMaintenance } from "./github-workspace-runner";

export type MessageIngestInput = {
  platform: string;
  platformTeamId?: string;
  channelId: string;
  channelName?: string;
  userId: string;
  userName?: string;
  messageId?: string;
  threadId?: string;
  text: string;
};

export class DuplicateMessageDelivery extends Error {}

export async function ingestSupportMessage(input: MessageIngestInput) {
  const channel = await resolveChannelContext(input);
  const repo = channel.defaultRepo ?? (await getPrimaryRepository(channel.orgId));
  if (!repo) throw new Error(`No watched repository is configured for ${input.platform}:${input.channelId}.`);

  const externalMessageId = input.messageId ?? crypto.randomUUID();
  const runId = `message-${crypto.randomUUID()}`;
  const { conversation, run, isNew } = await recordInboundMessage({
    platform: input.platform,
    platformTeamId: input.platformTeamId,
    platformChannelId: input.channelId,
    platformThreadId: input.threadId ?? externalMessageId,
    externalMessageId,
    content: input.text,
    actorId: input.userId,
    actorName: input.userName,
    orgId: channel.orgId,
    channelId: channel.id,
    run: {
      id: runId,
      orgId: channel.orgId,
      repoId: repo.id,
      kind: "message.support_answer",
      input: JSON.stringify(input),
      summary: `Support message from ${input.platform}:${input.channelId}`,
    },
  });
  if (!isNew || !run) throw new DuplicateMessageDelivery(`Message ${externalMessageId} was already processed.`);

  try {
    const latestRun = await prisma.run.findFirst({
      include: {
        artifacts: {
          orderBy: { createdAt: "desc" },
          take: 3,
        },
      },
      orderBy: { createdAt: "desc" },
      where: {
        id: { not: run.id },
        conversationId: conversation.id,
        orgId: channel.orgId,
        repoId: repo.id,
      },
    });
    const [recentArtifacts, priorMessages] = await Promise.all([
      prisma.artifact.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        where: {
          orgId: channel.orgId,
          repoId: repo.id,
          OR: [{ kind: { not: "support_answer" } }, { run: { conversationId: conversation.id } }],
        },
      }),
      prisma.conversationMessage
        .findMany({
          orderBy: { createdAt: "desc" },
          take: 12,
          where: { conversationId: conversation.id, externalMessageId: { not: externalMessageId } },
        })
        .then((messages) => messages.reverse()),
    ]);

    const repoUrl = githubRepoUrl(repo.fullName);

    const processWorkspaceRequest = async (options: {
      actionRequest: string;
      needsDocsUpdate: boolean;
      reply: string;
      runnerBackend: string;
      summary?: string;
    }) => {
      const workspaceResult = await runGithubWorkspaceMaintenance({
        baseBranch: repo.defaultBranch || "main",
        eventName: "message_workspace_request",
        executionConfig: {
          harness: repo.harnessType,
          model: repo.model,
          provider: repo.provider,
          reasoning: repo.reasoning,
        },
        prompt: buildWorkspaceRequestPrompt({
          actionRequest: options.actionRequest,
          channelName: channel.displayName ?? channel.platformChannelId,
          input,
          repoName: repo.fullName,
          repoUrl,
        }),
        repo: repo.fullName,
        runId: run.id,
      });

      await prisma.$transaction([
        prisma.artifact.create({
          data: {
            orgId: channel.orgId,
            repoId: repo.id,
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
        prisma.artifact.create({
          data: {
            orgId: channel.orgId,
            repoId: repo.id,
            runId: run.id,
            kind: "support_answer",
            title: `Support answer for ${input.platform}`,
            content: options.reply,
          },
        }),
        prisma.run.update({
          where: { id: run.id },
          data: {
            kind: "message.workspace_request",
            status: "completed",
            summary: workspaceResult.pushed
              ? `Ronin committed ${workspaceResult.changedFiles.length} file change${workspaceResult.changedFiles.length === 1 ? "" : "s"} from ${input.platform}.`
              : options.summary ?? "Ronin inspected the repo from a support request.",
            output: JSON.stringify({
              actionRequest: options.actionRequest,
              context: {
                channel: channel.displayName ?? channel.platformChannelId,
                org: channel.org.slug,
                repo: repo.fullName,
                repoUrl,
              },
              intent: "workspace_change",
              reply: options.reply,
              runnerBackend: options.runnerBackend,
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
            orgId: channel.orgId,
            repoId: repo.id,
            runId: run.id,
            actorType: input.platform,
            actorId: input.userId,
            action: "message.workspace_request_completed",
            target: input.channelId,
            metadata: JSON.stringify({
              channelName: input.channelName,
              changedFiles: workspaceResult.changedFiles,
              repo: repo.fullName,
              runnerBackend: options.runnerBackend,
            }),
          },
        }),
      ]);

      let prUrl: string | null = null;
      if (workspaceResult.pushed) {
        try {
          const pr = await openPullRequestForGithubRun(run.id);
          prUrl = pr.prUrl;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Auto PR creation failed.";
          await prisma.artifact.create({
            data: {
              orgId: channel.orgId,
              repoId: repo.id,
              runId: run.id,
              kind: "github_pr_error",
              title: "GitHub PR Error",
              content: message,
            },
          });
          throw new Error(`Ronin pushed the branch but could not open its PR: ${message}`);
        }
      }

      const actionReply = prUrl
        ? `${options.reply}\n\nOpened PR: ${prUrl}`
        : `${options.reply}\n\nRonin inspected the repo but did not produce a PR-worthy patch.`;

      return {
        ok: true,
        context: {
          channel: channel.displayName ?? channel.platformChannelId,
          org: channel.org.slug,
          repo: repo.fullName,
          repoUrl,
        },
        intent: "workspace_change",
        needsDocsUpdate: options.needsDocsUpdate,
        prUrl,
        reply: actionReply,
        runId: run.id,
        conversationId: conversation.id,
        runnerBackend: workspaceResult.runnerBackend,
        executionConfig: workspaceResult.executionConfig,
      };
    };

    const directActionRequest = detectWorkspaceActionRequest(input.text);
    if (directActionRequest) {
      return await processWorkspaceRequest({
        actionRequest: directActionRequest,
        needsDocsUpdate: true,
        reply: "I’ll make that change in the repository and open a PR.",
        runnerBackend: "ronin_direct_workspace_router",
        summary: "Ronin routed an explicit Slack repo-change request directly to the workspace runner.",
      });
    }

    const agent = await runTrackedCentaurTask({
      runId: run.id,
      purpose: "support",
      threadKey: buildThreadKey(["support", repo.fullName, conversation.id]),
      prompt: buildSupportPrompt({ artifacts: recentArtifacts, input, latestRun, messages: priorMessages, repoName: repo.fullName, repoUrl }),
      idempotencyKey: `${run.id}:support`,
      config: {
        harness: repo.harnessType,
        model: repo.model,
        provider: repo.provider,
        reasoning: repo.reasoning,
      },
    });
    const parsed = parseAgentJson(agent.rawOutput);
    const reply = stringOrFallback(parsed.reply, agent.rawOutput);
    const needsDocsUpdate = Boolean(parsed.needsDocsUpdate);
    const intent = parsed.intent === "workspace_change" ? "workspace_change" : "answer";

    if (intent === "workspace_change") {
      return await processWorkspaceRequest({
        actionRequest: stringOrFallback(parsed.actionRequest, input.text),
        needsDocsUpdate,
        reply,
        runnerBackend: agent.backend,
        summary: stringOrFallback(parsed.summary, "Ronin inspected the repo from a support request."),
      });
    }

    await prisma.$transaction([
      prisma.artifact.create({
        data: {
          orgId: channel.orgId,
          repoId: repo.id,
          runId: run.id,
          kind: "support_answer",
          title: `Support answer for ${input.platform}`,
          content: reply,
        },
      }),
      prisma.run.update({
        where: { id: run.id },
        data: {
          status: "completed",
          summary: stringOrFallback(parsed.summary, "Ronin answered a support question."),
          output: JSON.stringify({
            context: {
              channel: channel.displayName ?? channel.platformChannelId,
              org: channel.org.slug,
              repo: repo.fullName,
              repoUrl,
            },
            needsDocsUpdate,
            intent,
            reply,
            runnerBackend: agent.backend,
          }),
          completedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          orgId: channel.orgId,
          repoId: repo.id,
          runId: run.id,
          actorType: input.platform,
          actorId: input.userId,
          action: "message.support_answered",
          target: input.channelId,
          metadata: JSON.stringify({
            channelName: input.channelName,
            needsDocsUpdate,
            repo: repo.fullName,
            runnerBackend: agent.backend,
          }),
        },
      }),
    ]);

    return {
      ok: true,
      context: {
        channel: channel.displayName ?? channel.platformChannelId,
        org: channel.org.slug,
        repo: repo.fullName,
        repoUrl,
      },
      reply,
      needsDocsUpdate,
      intent,
      runId: run.id,
      conversationId: conversation.id,
      runnerBackend: agent.backend,
      executionConfig: agent.config,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Support message processing failed.";
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: "blocked",
        output: JSON.stringify({ error: message }),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

async function resolveChannelContext(input: MessageIngestInput) {
  const platformTeamId = input.platformTeamId ?? "";
  // Never auto-create a mapping: routing must come from an explicit operator
  // configured Slack/Telegram channel mapping.
  const existing = await prisma.channel.findUnique({
    include: {
      defaultRepo: true,
      org: true,
    },
    where: {
      platform_platformTeamId_platformChannelId: {
        platform: input.platform,
        platformTeamId,
        platformChannelId: input.channelId,
      },
    },
  });

  if (!existing) {
    throw new Error(
      `No Ronin channel mapping exists for ${input.platform}:${platformTeamId || "-"}:${input.channelId}. Configure the channel mapping before sending messages.`,
    );
  }

  return prisma.channel.update({
    data: {
      displayName: input.channelName ?? existing.displayName,
    },
    include: {
      defaultRepo: true,
      org: true,
    },
    where: { id: existing.id },
  });
}

async function getPrimaryRepository(orgId: string) {
  return prisma.repository.findFirst({
    orderBy: { createdAt: "asc" },
    where: {
      orgId,
      watchedEnabled: true,
    },
  });
}

function buildSupportPrompt(input: {
  artifacts: Array<{ kind: string; title: string; content: string }>;
  input: MessageIngestInput;
  latestRun: {
    summary: string | null;
    artifacts: Array<{ kind: string; title: string; content: string }>;
  } | null;
  messages: Array<{ role: string; actorName: string | null; content: string }>;
  repoName: string;
  repoUrl: string;
}) {
  const latestKnownIssues = input.latestRun?.artifacts.find((artifact) => artifact.kind === "known_issues_update")?.content;
  const latestSupportSeed = input.latestRun?.artifacts.find((artifact) => artifact.kind === "support_answer")?.content;

  return `You are Ronin, an agentic solutions engineer for a product team.
You are handling a message in a connected team or support channel.
Ronin has already resolved the tenant/channel/repo context. Do not ask the user which repo this is about.
If the user is asking a question, give a direct, useful answer grounded in the configured repo and Ronin artifacts.
If the user is asking Ronin to change code/docs/tests/config/examples and open a PR, set intent to "workspace_change" and summarize the requested change in actionRequest.
If the user asks for code/docs/tests/config/examples changes, return intent "workspace_change"; Ronin will run a token-backed workspace checkout separately.
If the question reveals missing docs or recurring confusion, set needsDocsUpdate to true.
Do not claim a PR was opened; Ronin will open it after your intent decision if policy allows.
Return ONLY valid JSON. No markdown fences. No extra prose.

Platform: ${input.input.platform}
Channel: ${input.input.channelName ?? input.input.channelId}
User: ${input.input.userName ?? input.input.userId}
Repo: ${input.repoName}
Repo URL: ${input.repoUrl}

Conversation history:
${input.messages.length ? input.messages.map((message) => `${message.role === "assistant" ? "Ronin" : message.actorName ?? "User"}: ${message.content.slice(0, 2000)}`).join("\n") : "No earlier messages in this conversation."}

Current message:
${input.input.text}

Latest ingest summary:
${input.latestRun?.summary ?? "No previous run summary is available."}

Latest support answer seed:
${latestSupportSeed ?? "No previous support answer artifact is available."}

Generated known issues:
${latestKnownIssues?.slice(0, 5000) ?? "No known-issues artifact is available yet."}

Recent Ronin artifacts:
${input.artifacts.length ? input.artifacts.map((artifact) => `## ${artifact.title} (${artifact.kind})\n${artifact.content.slice(0, 2500)}`).join("\n\n") : "None yet."}

Return JSON:
{
  "intent": "answer or workspace_change",
  "summary": "short internal summary",
  "reply": "message to send back to the requester",
  "actionRequest": "if intent is workspace_change, the concrete repo change Ronin should make",
  "needsDocsUpdate": true
}`;
}

function detectWorkspaceActionRequest(text: string) {
  // Only an explicit PR request bypasses agent classification. Generic
  // fix/change wording must go through classification so writes stay gated.
  const normalized = text.toLowerCase();
  const asksForPr = /\b(open|create|raise|file|submit)\s+(a\s+)?(pr|pull request)\b/.test(normalized);
  return asksForPr ? text.trim() : null;
}

function buildWorkspaceRequestPrompt(input: {
  actionRequest: string;
  channelName: string;
  input: MessageIngestInput;
  repoName: string;
  repoUrl: string;
}) {
  return `A builder asked Ronin from ${input.input.platform} channel ${input.channelName} to make a repository change.

Repo: ${input.repoName}
Repo URL: ${input.repoUrl}
Requester: ${input.input.userName ?? input.input.userId}

Original message:
${input.input.text}

Action request:
${input.actionRequest}

Make the smallest useful repo change that satisfies this request. Prefer docs/examples/tests/code edits over generated reports. Do not merge, deploy, rotate secrets, or spend money. Return a PR-ready JSON report.`;
}

function parseAgentJson(rawOutput: string): Record<string, unknown> {
  try {
    return JSON.parse(rawOutput) as Record<string, unknown>;
  } catch {
    const match = rawOutput.match(/\{[\s\S]*\}/);
    if (!match) return { reply: rawOutput };
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function githubRepoUrl(fullName: string) {
  if (fullName.startsWith("http://") || fullName.startsWith("https://")) return fullName;
  return `https://github.com/${fullName.replace(/^\/+|\/+$/g, "")}`;
}
