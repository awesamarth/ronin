import { execFileSync } from "node:child_process";
import { createInstallationToken } from "./github-app";

export type WorkspaceRunInput = {
  afterSha?: string;
  baseBranch: string;
  beforeSha?: string;
  changelogDraft?: string;
  eventName?: string;
  installationId: string;
  prompt: string;
  repo: string;
  runId: string;
};

export type WorkspaceRunResult = {
  branch: string;
  changedFiles: string[];
  commitSha: string | null;
  diff: string;
  hermesOutput: string;
  prBody: string;
  prTitle: string;
  pushed: boolean;
  testLog: string;
  workspace: string;
};

type SandboxWorkspaceResult = {
  branch?: string;
  changedFiles?: string[];
  commitSha?: string | null;
  diff?: string;
  hermesOutput?: string;
  pushed?: boolean;
  runnerChecks?: string;
  status?: string;
  workspace?: string;
};

type WorkspaceReport = {
  changedFiles?: string[];
  commandsRun?: string[];
  prBody?: string;
  prTitle?: string;
  summary?: string;
  tests?: string;
};

const RESULT_START = "__RONIN_RESULT_START__";
const RESULT_END = "__RONIN_RESULT_END__";

export async function runGithubWorkspaceMaintenance(input: WorkspaceRunInput): Promise<WorkspaceRunResult> {
  const { token } = await createInstallationToken(input.installationId);
  const branch = `ronin/patch-${input.runId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
  const workspace = `/sandbox/ronin-runs/${input.runId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 96)}`;
  const hermesTimeoutMs = Number(process.env.RONIN_WORKSPACE_TIMEOUT_MS ?? 420_000);
  const sandboxOutput = runInSandbox({
    script: buildSandboxScript({
      branch,
      changelogDraft: input.changelogDraft ?? "",
      commitMessage: commitMessage(input),
      prompt: buildWorkspacePrompt(input),
      repo: input.repo,
      token,
      workspace,
    }),
    timeoutMs: hermesTimeoutMs + 180_000,
  });
  const sandboxResult = parseSandboxResult(sandboxOutput);
  const hermesOutput = sandboxResult.hermesOutput ?? "";
  const report = parseWorkspaceReport(hermesOutput);
  const changedFiles = normalizedChangedFiles(sandboxResult.changedFiles, report.changedFiles);
  const testLog = mergeTestLogs(report.tests ?? commandListToText(report.commandsRun), sandboxResult.runnerChecks);
  const prBody = buildPrBody({
    changedFiles,
    input,
    report,
    runnerChecks: sandboxResult.runnerChecks,
    pushed: Boolean(sandboxResult.pushed),
    testLog,
  });

  return {
    branch: sandboxResult.branch ?? branch,
    changedFiles,
    commitSha: sandboxResult.commitSha ?? null,
    diff: sandboxResult.diff ?? "",
    hermesOutput,
    prBody,
    prTitle: report.prTitle ?? (sandboxResult.pushed ? `Ronin: update docs and integration knowledge` : `Ronin: inspect ${input.repo}`),
    pushed: Boolean(sandboxResult.pushed),
    testLog: sandboxResult.status && !sandboxResult.pushed ? `${testLog}\n\nSandbox status: ${sandboxResult.status}` : testLog,
    workspace: sandboxResult.workspace ?? workspace,
  };
}

function runInSandbox(input: { script: string; timeoutMs: number }) {
  const sandboxName = process.env.RONIN_OPENSHELL_SANDBOX_NAME ?? "hermes";
  const timeoutSeconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));

  return execFileSync(
    "openshell",
    ["sandbox", "exec", "-n", sandboxName, "--no-tty", "--timeout", String(timeoutSeconds), "--", "bash", "-s"],
    {
      encoding: "utf8",
      input: input.script,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: input.timeoutMs,
    },
  );
}

function buildSandboxScript(input: {
  branch: string;
  changelogDraft: string;
  commitMessage: string;
  prompt: string;
  repo: string;
  token: string;
  workspace: string;
}) {
  return `#!/usr/bin/env bash
set -euo pipefail
umask 077

${assignHereDoc("GITHUB_TOKEN", input.token)}
${assignHereDoc("RONIN_REPO", input.repo)}
${assignHereDoc("RONIN_BRANCH", input.branch)}
${assignHereDoc("RONIN_WORKSPACE", input.workspace)}
${assignHereDoc("RONIN_COMMIT_MESSAGE", input.commitMessage)}
${assignHereDoc("RONIN_CHANGELOG_DRAFT", input.changelogDraft)}

rm -rf "$RONIN_WORKSPACE"
mkdir -p "$RONIN_WORKSPACE"
cd "$RONIN_WORKSPACE"

export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash > "$RONIN_WORKSPACE/bun-install.log" 2>&1 || true
  export PATH="$HOME/.bun/bin:$PATH"
fi
if ! command -v bun >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  npm install --global --prefix "$HOME/.bun" bun >> "$RONIN_WORKSPACE/bun-install.log" 2>&1 || true
  export PATH="$HOME/.bun/bin:$PATH"
fi

cat > prompt.txt <<'__RONIN_PROMPT__'
${input.prompt}
__RONIN_PROMPT__

cat > git-askpass.sh <<'__RONIN_ASKPASS__'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\\n' "x-access-token" ;;
  *Password*) printf '%s\\n' "$GITHUB_TOKEN" ;;
  *) printf '\\n' ;;
esac
__RONIN_ASKPASS__
chmod 700 git-askpass.sh

export GIT_ASKPASS="$RONIN_WORKSPACE/git-askpass.sh"
export GIT_TERMINAL_PROMPT=0

git clone --depth 80 "https://github.com/$RONIN_REPO.git" repo
cd repo
git remote set-url origin "https://github.com/$RONIN_REPO.git"
git config user.name "Ronin Agent"
git config user.email "ronin-agent@users.noreply.github.com"
git checkout -B "$RONIN_BRANCH"
git rev-parse HEAD > "$RONIN_WORKSPACE/base-sha.txt"
BASE_SHA="$(cat "$RONIN_WORKSPACE/base-sha.txt")"

set +e
hermes --skills ronin -z "$(cat "$RONIN_WORKSPACE/prompt.txt")" > "$RONIN_WORKSPACE/hermes-output.txt" 2> "$RONIN_WORKSPACE/hermes-error.txt"
HERMES_EXIT=$?
set -e
if [ "$HERMES_EXIT" -ne 0 ]; then
  {
    printf 'Hermes exited with code %s\\n\\n' "$HERMES_EXIT"
    cat "$RONIN_WORKSPACE/hermes-error.txt"
  } >> "$RONIN_WORKSPACE/hermes-output.txt"
fi

python3 - <<'__RONIN_CHANGELOG_PY__'
import os
from pathlib import Path

draft = os.environ.get("RONIN_CHANGELOG_DRAFT", "").strip()
run_marker = os.environ.get("RONIN_WORKSPACE", "").rsplit("/", 1)[-1]
if draft and "no changelog" not in draft.lower():
    path = Path("CHANGELOG.md")
    existing = path.read_text() if path.exists() else ""
    if run_marker not in existing and draft not in existing:
        from datetime import date
        entry = f"## Ronin update {date.today().isoformat()}\\n\\n<!-- ronin-run:{run_marker} -->\\n\\n{draft}\\n\\n"
        path.write_text((entry + existing) if existing else "# Changelog\\n\\n" + entry)
__RONIN_CHANGELOG_PY__

if [ -f bun.lock ] || [ -f bun.lockb ]; then
  if ! git cat-file -e "$BASE_SHA:package-lock.json" 2>/dev/null && [ -f package-lock.json ]; then
    rm -f package-lock.json
  fi
fi

cat > "$RONIN_WORKSPACE/run-checks.sh" <<'__RONIN_CHECKS_SH__'
#!/usr/bin/env bash
set +e
checks_log="$RONIN_WORKSPACE/runner-checks.txt"
: > "$checks_log"

run_check() {
  printf '$ %s\\n' "$*" >> "$checks_log"
  "$@" >> "$checks_log" 2>&1
  status=$?
  if [ "$status" -eq 0 ]; then
    printf 'PASS\\n\\n' >> "$checks_log"
  else
    printf 'FAIL (%s)\\n\\n' "$status" >> "$checks_log"
  fi
  return 0
}

has_script() {
  node -e 'const pkg=require("./package.json"); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)' "$1" >/dev/null 2>&1
}

if [ ! -f package.json ]; then
  printf 'Skipped: no package.json found.\\n' >> "$checks_log"
elif ! command -v bun >/dev/null 2>&1; then
  printf 'Skipped: bun is unavailable in the sandbox PATH.\\n' >> "$checks_log"
else
  run_check bun --version
  if [ -f bun.lock ] || [ -f bun.lockb ]; then
    run_check bun install --frozen-lockfile
  elif [ -d node_modules ]; then
    printf 'Skipped install: no bun lockfile, existing node_modules present.\\n\\n' >> "$checks_log"
  elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
    run_check npm ci
  else
    printf 'Skipped install: no bun lockfile; Ronin will not create a new lockfile during maintenance.\\n\\n' >> "$checks_log"
  fi

  if has_script lint; then
    run_check bun run lint
  fi
  if has_script build; then
    run_check bun run build
  fi
fi
__RONIN_CHECKS_SH__
chmod 700 "$RONIN_WORKSPACE/run-checks.sh"
"$RONIN_WORKSPACE/run-checks.sh"

git status --porcelain > "$RONIN_WORKSPACE/status.txt"
HEAD_SHA="$(git rev-parse HEAD)"
if [ ! -s "$RONIN_WORKSPACE/status.txt" ] && [ "$HEAD_SHA" = "$BASE_SHA" ]; then
  python3 - <<'__RONIN_NO_CHANGES_PY__'
import json
from pathlib import Path
print("${RESULT_START}")
print(json.dumps({
  "branch": "${jsonEscapeForPython(input.branch)}",
  "changedFiles": [],
  "commitSha": None,
  "diff": "",
  "hermesOutput": Path("../hermes-output.txt").read_text(errors="replace"),
  "pushed": False,
  "runnerChecks": Path("../runner-checks.txt").read_text(errors="replace") if Path("../runner-checks.txt").exists() else "",
  "status": "no_changes",
  "workspace": str(Path.cwd().parent),
}))
print("${RESULT_END}")
__RONIN_NO_CHANGES_PY__
  exit 0
fi

if [ -s "$RONIN_WORKSPACE/status.txt" ]; then
  git add --all
  git commit -m "$RONIN_COMMIT_MESSAGE"
fi
git diff "$BASE_SHA"..HEAD -- . > "$RONIN_WORKSPACE/diff.txt"
git diff --name-only "$BASE_SHA"..HEAD -- > "$RONIN_WORKSPACE/changed-files.txt"
git rev-parse HEAD > "$RONIN_WORKSPACE/commit-sha.txt"
REMOTE_SHA=""
if git ls-remote --exit-code --heads origin "$RONIN_BRANCH" > "$RONIN_WORKSPACE/remote-branch.txt" 2>/dev/null; then
  REMOTE_SHA="$(cut -f1 "$RONIN_WORKSPACE/remote-branch.txt" | head -n1)"
fi
if [ -n "$REMOTE_SHA" ]; then
  git push origin "HEAD:refs/heads/$RONIN_BRANCH" "--force-with-lease=refs/heads/$RONIN_BRANCH:$REMOTE_SHA"
else
  git push origin "HEAD:refs/heads/$RONIN_BRANCH" "--force-with-lease=refs/heads/$RONIN_BRANCH:"
fi

python3 - <<'__RONIN_RESULT_PY__'
import json
from pathlib import Path

root = Path.cwd().parent
changed = [line.strip() for line in (root / "changed-files.txt").read_text().splitlines() if line.strip()]
print("${RESULT_START}")
print(json.dumps({
  "branch": "${jsonEscapeForPython(input.branch)}",
  "changedFiles": changed,
  "commitSha": (root / "commit-sha.txt").read_text().strip(),
  "diff": (root / "diff.txt").read_text(errors="replace"),
  "hermesOutput": (root / "hermes-output.txt").read_text(errors="replace"),
  "pushed": True,
  "runnerChecks": (root / "runner-checks.txt").read_text(errors="replace") if (root / "runner-checks.txt").exists() else "",
  "status": "pushed",
  "workspace": str(root),
}))
print("${RESULT_END}")
__RONIN_RESULT_PY__
`;
}

function assignHereDoc(name: string, value: string) {
  const delimiter = `__RONIN_${name}_${Math.random().toString(36).slice(2)}__`;
  return `read -r -d '' ${name} <<'${delimiter}' || true
${value}
${delimiter}
export ${name}`;
}

function parseSandboxResult(output: string): SandboxWorkspaceResult {
  const start = output.indexOf(RESULT_START);
  const end = output.indexOf(RESULT_END, start + RESULT_START.length);
  if (start === -1 || end === -1) {
    throw new Error(`Sandbox workspace run did not return a Ronin result marker. Output:\n${output.slice(-4000)}`);
  }

  const jsonText = output.slice(start + RESULT_START.length, end).trim();
  try {
    return JSON.parse(jsonText) as SandboxWorkspaceResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`Sandbox workspace run returned invalid JSON: ${message}`);
  }
}

function buildWorkspacePrompt(input: WorkspaceRunInput) {
  return `Use the Ronin skill.

You are running inside a checked-out GitHub repository workspace for ${input.repo}.

Task:
- Inspect this repository and the event context below.
- Make useful file edits directly in the working tree.
- For docs drift, update existing docs/README files when they exist.
- If no docs exist and this is a JS/TS repo, add Fumadocs docs when the request or onboarding context calls for docs.
- For changelog-worthy pushes, update or create CHANGELOG.md.
- For examples/tests/code fixes, make the smallest useful change when the issue is clear.
- Do not push, merge, deploy, or spend money.
- Do not edit secrets or generated dependency lockfiles unless necessary.
- Run lightweight checks when obvious and available.

Event:
- runId: ${input.runId}
- event: ${input.eventName ?? "unknown"}
- baseBranch: ${input.baseBranch}
- before: ${input.beforeSha ?? "unknown"}
- after: ${input.afterSha ?? "unknown"}

Diff/changelog context:
${input.changelogDraft ?? "No changelog draft was provided."}

Original Ronin diff-analysis prompt:
${input.prompt}

When finished, return ONLY JSON:
{
  "summary": "what you changed",
  "changedFiles": ["file.md"],
  "commandsRun": ["bun test"],
  "tests": "test results or why not run",
  "prTitle": "Ronin: concise PR title",
  "prBody": "Markdown PR body with summary, changed files, and checks"
}`;
}

function parseWorkspaceReport(output: string): WorkspaceReport {
  try {
    return JSON.parse(output) as WorkspaceReport;
  } catch {
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as WorkspaceReport;
    } catch {
      return {};
    }
  }
}

function normalizedChangedFiles(primary: string[] | undefined, fallback: string[] | undefined) {
  return Array.from(new Set([...(primary ?? []), ...(fallback ?? [])].map((file) => file.trim()).filter(Boolean)));
}

function commandListToText(commands: string[] | undefined) {
  if (!commands?.length) return null;
  return commands.map((command) => `- ${command}`).join("\n");
}

function mergeTestLogs(hermesTests: string | null, runnerChecks: string | undefined) {
  const parts = [];
  if (hermesTests?.trim()) parts.push(hermesTests.trim());
  if (runnerChecks?.trim()) parts.push(`Ronin sandbox checks:\n${runnerChecks.trim()}`);
  return parts.join("\n\n") || "Hermes did not report tests.";
}

function buildPrBody(input: {
  changedFiles: string[];
  input: WorkspaceRunInput;
  pushed: boolean;
  report: WorkspaceReport;
  runnerChecks: string | undefined;
  testLog: string;
}) {
  if (!input.pushed) return "Ronin inspected the repo and did not find a useful file change to commit.";

  const summary = input.report.summary?.trim() || firstSection(input.report.prBody) || "Ronin committed maintenance changes.";
  const checks = input.runnerChecks?.trim() || input.testLog.trim();

  return `## Summary

${summary}

## Changed files

${input.changedFiles.map((file) => `- \`${file}\``).join("\n") || "- None reported"}

## Ronin sandbox checks

\`\`\`text
${checks || "No checks were reported."}
\`\`\``;
}

function firstSection(value: string | undefined) {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(/^#+\s*Summary\s*/i, "").trim();
  const [first] = normalized.split(/\n##\s+/);
  return first?.trim() || null;
}

function commitMessage(input: WorkspaceRunInput) {
  if (input.eventName === "push") return `Ronin: update docs for ${input.afterSha?.slice(0, 7) ?? input.runId}`;
  if (input.eventName === "repository_onboarded") return `Ronin: onboard repository docs`;
  return `Ronin: apply maintenance updates for ${input.runId}`;
}

function jsonEscapeForPython(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
