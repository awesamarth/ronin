import { buildThreadKey, type CentaurExecutionConfig, type CentaurResult } from "./centaur-client";
import { prepareGithubRepoCredential } from "./github-credential-broker";
import { createInstallationToken } from "./github-app";
import { prisma } from "./prisma";
import { runTrackedCentaurTask } from "./tracked-centaur";

export type WorkspaceRunInput = {
  afterSha?: string;
  baseBranch: string;
  beforeSha?: string;
  changelogDraft?: string;
  eventName?: string;
  executionConfig?: CentaurExecutionConfig;
  prompt: string;
  repo: string;
  runId: string;
};

export type WorkspaceRunResult = {
  branch: string;
  changedFiles: string[];
  commitSha: string | null;
  diff: string;
  agentOutput: string;
  prBody: string;
  prTitle: string;
  pushed: boolean;
  testLog: string;
  workspace: string;
  runnerBackend: string;
  executionConfig: CentaurResult["config"];
};

type WorkspaceReport = {
  branch?: string;
  changedFiles?: string[];
  commitSha?: string | null;
  diff?: string;
  summary?: string;
  commandsRun?: string[];
  tests?: string;
  prTitle?: string;
  prBody?: string;
  pushed?: boolean;
  error?: string | null;
};

const REQUIRED_FIELDS: Array<keyof WorkspaceReport> = [
  "summary",
  "changedFiles",
  "commandsRun",
  "tests",
  "prTitle",
  "prBody",
  "branch",
  "commitSha",
  "pushed",
  "diff",
  "error",
];

export async function runGithubWorkspaceMaintenance(input: WorkspaceRunInput): Promise<WorkspaceRunResult> {
  const run = await prisma.run.findUnique({
    where: { id: input.runId },
    select: {
      actorUserId: true,
      orgId: true,
      org: { select: { githubInstallationId: true } },
      repo: { select: { fullName: true, githubRepoId: true } },
    },
  });
  if (!run?.repo || run.repo.fullName !== input.repo) throw new Error(`Run ${input.runId} is not authorized for repository ${input.repo}.`);
  if (!run.org.githubInstallationId) throw new Error(`Organization has no GitHub App installation for ${input.repo}.`);
  if (!run.repo.githubRepoId) throw new Error(`Repository ${input.repo} has no verified GitHub repository id.`);
  const installationId = run.org.githubInstallationId;
  const repositoryId = run.repo.githubRepoId;

  const branch = `ronin/patch-${input.runId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
  const threadKey = buildThreadKey(["workspace", input.repo, input.runId]);
  let result: CentaurResult;
  try {
    result = await runTrackedCentaurTask({
      runId: input.runId,
      purpose: "workspace",
      threadKey,
      prompt: buildWorkspacePrompt({ input, branch }),
      timeoutMs: Number(process.env.RONIN_WORKSPACE_TIMEOUT_MS ?? 180_000),
      idempotencyKey: `${input.runId}:workspace`,
      config: input.executionConfig,
      prepareSession: async ({ principalId, sandboxReady }) => {
        if (!principalId) throw new Error("Centaur session has no credential principal.");
        const cleanup = await prepareGithubRepoCredential({
          installationId,
          principalId,
          repo: input.repo,
          repositoryId,
          runId: input.runId,
          sandboxReady,
        });
        try {
          await prisma.auditLog.create({
            data: {
              orgId: run.orgId,
              actorType: run.actorUserId ? "user" : "system",
              actorId: run.actorUserId ?? "ronin",
              action: "github.workspace_credential_attached",
              target: input.repo,
              metadata: JSON.stringify({ principalId, runId: input.runId, sandboxReady }),
            },
          });
        } catch (error) {
          await cleanup();
          throw error;
        }
        return async () => {
          try {
            await cleanup();
            await prisma.auditLog.create({
              data: {
                orgId: run.orgId,
                actorType: "system",
                actorId: "ronin",
                action: "github.workspace_credential_deleted",
                target: input.repo,
                metadata: JSON.stringify({ principalId, runId: input.runId }),
              },
            });
          } catch (error) {
            await prisma.auditLog.create({
              data: {
                orgId: run.orgId,
                actorType: "system",
                actorId: "ronin",
                action: "github.workspace_credential_cleanup_failed",
                target: input.repo,
                metadata: JSON.stringify({ principalId, runId: input.runId }),
              },
            });
            throw error;
          }
        };
      },
    });
  } catch (error) {
    const recovered = await recoverPushedWorkspace({ branch, error, input, installationId, repositoryId });
    if (recovered) return recovered;
    throw error;
  }

  const report = parseWorkspaceReport(result.rawOutput);

  // Validate strict JSON output.
  if (!report) {
    throw new Error(`Centaur workspace run did not return valid JSON. Output:\n${result.rawOutput.slice(-4000)}`);
  }

  if (report.error !== undefined && report.error !== null && typeof report.error !== "string") {
    throw new Error(`Centaur workspace report field "error" must be a string or null.`);
  }
  if (report.error?.trim()) throw new Error(`Centaur workspace run failed: ${report.error.trim()}`);

  // Check for required fields — treat missing fields as malformed output.
  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = report[field];
    if (value === undefined) return true;
    if (value === null) return field !== "commitSha" && field !== "error";
    if (typeof value === "string" && value.length === 0 && field !== "commitSha" && field !== "diff") return true;
    return false;
  });
  if (missing.length) {
    throw new Error(`Centaur workspace report is missing required fields: ${missing.join(", ")}`);
  }

  // Validate types strictly — never coerce (Boolean("false") must not pass).
  if (typeof report.pushed !== "boolean") {
    throw new Error(`Centaur workspace report field "pushed" must be a boolean.`);
  }
  if (!isStringArray(report.changedFiles)) {
    throw new Error(`Centaur workspace report field "changedFiles" must be an array of strings.`);
  }
  if (!isStringArray(report.commandsRun)) {
    throw new Error(`Centaur workspace report field "commandsRun" must be an array of strings.`);
  }

  // A claim of pushed=true requires the requested deterministic branch and a
  // commit SHA that looks like a Git SHA.
  if (report.pushed) {
    if (report.branch !== branch) {
      throw new Error(`Centaur reported pushed=true on branch ${report.branch} but Ronin requested ${branch}.`);
    }
    if (!report.commitSha || !/^[0-9a-f]{7,40}$/i.test(report.commitSha)) {
      throw new Error(`Centaur reported pushed=true without a valid commitSha.`);
    }
  }

  const changedFiles = report.changedFiles;
  const testLog = mergeTestLogs(report.tests, report.commandsRun);

  return {
    branch: report.branch ?? branch,
    changedFiles,
    commitSha: report.commitSha ?? null,
    diff: report.diff ?? "",
    agentOutput: result.rawOutput,
    prBody: report.prBody ?? "",
    prTitle: report.prTitle ?? (report.pushed ? "Ronin: update docs and integration knowledge" : `Ronin: inspect ${input.repo}`),
    pushed: report.pushed,
    testLog,
    workspace: threadKey,
    runnerBackend: result.backend,
    executionConfig: result.config,
  };
}

export async function recoverPushedWorkspace(input: {
  branch: string;
  error: unknown;
  input: WorkspaceRunInput;
  installationId: string;
  repositoryId: string;
}): Promise<WorkspaceRunResult | null> {
  const id = Number(input.repositoryId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const { token } = await createInstallationToken(input.installationId, {
    repositoryIds: [id],
    permissions: { contents: "read" },
  });
  const response = await fetch(
    `https://api.github.com/repos/${input.input.repo}/compare/${encodeURIComponent(input.input.baseBranch)}...${encodeURIComponent(input.branch)}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) return null;
  const compare = (await response.json()) as {
    ahead_by?: number;
    commits?: Array<{ sha?: string }>;
    files?: Array<{ filename?: string; patch?: string }>;
  };
  const changedFiles = (compare.files ?? []).flatMap((file) => file.filename ? [file.filename] : []);
  const commitSha = compare.commits?.at(-1)?.sha;
  if (!compare.ahead_by || !changedFiles.length || !commitSha) return null;

  const reason = (input.error instanceof Error ? input.error.message : "Centaur execution ended before its final report.").slice(0, 500);
  const config = {
    harness: input.input.executionConfig?.harness || process.env.RONIN_HARNESS || "pi",
    model: input.input.executionConfig?.model || process.env.RONIN_MODEL,
    provider: input.input.executionConfig?.provider || process.env.RONIN_PROVIDER,
    reasoning: input.input.executionConfig?.reasoning || process.env.RONIN_REASONING,
  };
  return {
    branch: input.branch,
    changedFiles,
    commitSha,
    diff: (compare.files ?? []).map((file) => file.patch ?? "").filter(Boolean).join("\n"),
    agentOutput: JSON.stringify({ recoveredFromPushedBranch: true, reason }),
    prBody: `## Summary\n\nRonin changed ${changedFiles.map((file) => `\`${file}\``).join(", ")}.\n\n## Checks\n\nThe branch was recovered after the agent pushed successfully but did not return its final report; verify repository CI before merging.`,
    prTitle: `Ronin: update ${changedFiles[0]}`,
    pushed: true,
    testLog: "Branch recovered after push; final agent check report unavailable. Verify repository CI before merging.",
    workspace: buildThreadKey(["workspace", input.input.repo, input.input.runId]),
    runnerBackend: `centaur/${config.harness}`,
    executionConfig: config,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function buildWorkspacePrompt(input: { input: WorkspaceRunInput; branch: string }): string {
  const { input: runInput } = input;
  return `You are Ronin, an agentic solutions engineer running through Centaur.

Repository: ${runInput.repo}
Branch to create: ${input.branch}
Base branch: ${runInput.baseBranch}
Run ID: ${runInput.runId}
Event: ${runInput.eventName ?? "unknown"}

Task:
- Clone the exact target repository over HTTPS. Authentication is brokered transparently for this repository only; no token is available in your environment.
- Create and checkout the branch ${input.branch}.
- Make the requested changes below directly in the working tree.
- For docs drift, update existing docs/README files when they exist.
- If no docs exist and this is a JS/TS repo, add Fumadocs docs when the request or onboarding context calls for docs.
- For changelog-worthy pushes, update or create CHANGELOG.md.
- For examples/tests/code fixes, make the smallest useful change when the issue is clear.
- Run focused checks (bun install, lint, build, or tests) when available and relevant.
- Before committing, set repository-local Git author name/email from the base branch's latest commit when no identity is configured.
- Commit your changes and push the branch to origin over HTTPS; the exact-repository credential is injected by the network proxy.
- Do not merge, deploy, rotate secrets, or spend money.
- Do not edit generated dependency lockfiles unless necessary.

Changelog context:
${runInput.changelogDraft ?? "No changelog draft was provided."}

Diff context:
- before: ${runInput.beforeSha ?? "unknown"}
- after: ${runInput.afterSha ?? "unknown"}

Original Ronin task:
${runInput.prompt}

When finished, return ONLY strict JSON (no markdown fences, no extra prose) with this exact shape:
{
  "summary": "what you changed",
  "changedFiles": ["file.md"],
  "commandsRun": ["bun test"],
  "tests": "test results or why not run",
  "prTitle": "Ronin: concise PR title",
  "prBody": "Markdown PR body with summary, changed files, and checks",
  "branch": "${input.branch}",
  "commitSha": "sha or null if not pushed",
  "pushed": true,
  "diff": "the git diff of your changes",
  "error": null
}

Set error to a concise operational failure message instead of null when repository access, editing, checks, commit, or push could not be completed.`;
}

function parseWorkspaceReport(output: string): WorkspaceReport | null {
  try {
    return JSON.parse(output) as WorkspaceReport;
  } catch {
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as WorkspaceReport;
    } catch {
      return null;
    }
  }
}

function mergeTestLogs(tests: string | undefined, commands: string[] | undefined): string {
  const parts: string[] = [];
  if (tests?.trim()) parts.push(tests.trim());
  if (commands?.length) {
    parts.push(`Commands run:\n${commands.map((c) => `- ${c}`).join("\n")}`);
  }
  return parts.join("\n\n") || "No tests were reported.";
}
