import { runCentaurTask, buildThreadKey, type CentaurExecutionConfig } from "./centaur-client";
import { prisma } from "./prisma";

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
  const branch = `ronin/patch-${input.runId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
  const threadKey = buildThreadKey(["workspace", input.repo, input.runId]);
  const result = await runCentaurTask({
    threadKey,
    prompt: buildWorkspacePrompt({ input, branch }),
    timeoutMs: Number(process.env.RONIN_WORKSPACE_TIMEOUT_MS ?? 600_000),
    idempotencyKey: `${input.runId}:workspace`,
    config: input.executionConfig,
    onExecutionStarted: ({ executionId, threadKey: startedThreadKey }) =>
      prisma.run.update({
        where: { id: input.runId },
        data: { centaurExecutionId: executionId, centaurThreadKey: startedThreadKey },
      }),
  });

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
- Clone the target GitHub repository using the operator-configured GITHUB_TOKEN available in your environment.
- Create and checkout the branch ${input.branch}.
- Make the requested changes below directly in the working tree.
- For docs drift, update existing docs/README files when they exist.
- If no docs exist and this is a JS/TS repo, add Fumadocs docs when the request or onboarding context calls for docs.
- For changelog-worthy pushes, update or create CHANGELOG.md.
- For examples/tests/code fixes, make the smallest useful change when the issue is clear.
- Run focused checks (bun install, lint, build, or tests) when available and relevant.
- Commit your changes and push the branch to origin using the operator-configured GITHUB_TOKEN.
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
