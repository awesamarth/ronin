import { createInstallationToken } from "./github-app";
import { prisma } from "./prisma";

type GitHubPullRequest = {
  html_url: string;
  number: number;
};

type GitHubPullRequestListItem = GitHubPullRequest;

export async function openPullRequestForLatestGithubRun() {
  const run = await prisma.run.findFirst({
    include: {
      artifacts: {
        orderBy: {
          createdAt: "asc",
        },
      },
      org: true,
      repo: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    where: {
      kind: {
        startsWith: "github.",
      },
      status: "completed",
    },
  });

  if (!run) throw new Error("No completed GitHub run is available for PR creation.");
  return openPullRequestForGithubRun(run.id);
}

export async function openPullRequestForGithubRun(runId: string) {
  const run = await prisma.run.findUnique({
    include: {
      artifacts: {
        orderBy: {
          createdAt: "asc",
        },
      },
      org: true,
      repo: true,
    },
    where: {
      id: runId,
    },
  });

  if (!run) throw new Error(`Run ${runId} was not found.`);
  if (!run.kind.startsWith("github.") && run.kind !== "message.workspace_request") {
    throw new Error(`Run ${run.id} cannot be opened as a GitHub PR.`);
  }
  if (run.status !== "completed") throw new Error(`Run ${run.id} is not completed.`);
  if (!run.repo) throw new Error(`Run ${run.id} is not linked to a repository.`);

  const existingPr = run.artifacts.find((artifact) => artifact.kind === "github_pull_request");
  if (existingPr) {
    return {
      alreadyExists: true,
      prUrl: existingPr.content,
      runId: run.id,
    };
  }

  const input = parseRunInput(run.input);
  const installationId = input.installationId ?? run.org.githubInstallationId ?? process.env.GITHUB_INSTALLATION_ID;
  if (!installationId) throw new Error("GitHub installation id is not configured for this run.");

  const token = (await createInstallationToken(installationId)).token;
  const baseBranch = run.repo.defaultBranch || "main";
  const workspacePatch = parseWorkspacePatch(run.artifacts.find((artifact) => artifact.kind === "github_workspace_patch")?.content);
  if (workspacePatch?.pushed) {
    return openPullRequestForPushedBranch({
      baseBranch,
      changedFiles: workspacePatch.changedFiles ?? [],
      branch: workspacePatch.branch,
      prBody: workspacePatch.prBody,
      prTitle: workspacePatch.prTitle,
      run,
      token,
    });
  }
  throw new Error(`Run ${run.id} has no pushed workspace patch to open as a PR.`);
}

async function openPullRequestForPushedBranch(input: {
  baseBranch: string;
  branch: string;
  changedFiles: string[];
  prBody?: string;
  prTitle?: string;
  run: {
    id: string;
    orgId: string;
    repoId: string | null;
    repo: { fullName: string } | null;
    summary: string | null;
  };
  token: string;
}) {
  if (!input.run.repo) throw new Error(`Run ${input.run.id} is not linked to a repository.`);

  const existingPullRequest = await findOpenPullRequestForBranch({
    branch: input.branch,
    repo: input.run.repo.fullName,
    token: input.token,
  });
  if (existingPullRequest) return persistPullRequestArtifact({ input, pullRequest: existingPullRequest });

  let pullRequest: GitHubPullRequest;
  try {
    pullRequest = await githubRequest<GitHubPullRequest>({
      body: {
        base: input.baseBranch,
        body:
          input.prBody ??
          `Ronin committed repository maintenance changes for run \`${input.run.id}\`.

${input.changedFiles.length ? `Changed files:\n${input.changedFiles.map((file) => `- \`${file}\``).join("\n")}` : ""}`,
        head: input.branch,
        title: input.prTitle ?? `Ronin: update ${input.run.repo.fullName}`,
      },
      method: "POST",
      path: `/repos/${input.run.repo.fullName}/pulls`,
      token: input.token,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes(" 422 ")) {
      const existingAfterConflict = await findOpenPullRequestForBranch({
        branch: input.branch,
        repo: input.run.repo.fullName,
        token: input.token,
      });
      if (existingAfterConflict) return persistPullRequestArtifact({ input, pullRequest: existingAfterConflict });
    }
    throw error;
  }

  return persistPullRequestArtifact({ input, pullRequest });
}

async function persistPullRequestArtifact(input: {
  input: {
    branch: string;
    changedFiles: string[];
    run: {
      id: string;
      orgId: string;
      repoId: string | null;
      repo: { fullName: string } | null;
    };
  };
  pullRequest: GitHubPullRequest;
}) {
  if (!input.input.run.repo) throw new Error(`Run ${input.input.run.id} is not linked to a repository.`);

  const existingArtifact = await prisma.artifact.findFirst({
    where: {
      kind: "github_pull_request",
      runId: input.input.run.id,
    },
  });
  if (existingArtifact) {
    return {
      alreadyExists: true,
      prUrl: existingArtifact.content,
      runId: input.input.run.id,
    };
  }

  await prisma.$transaction([
    prisma.artifact.create({
      data: {
        content: input.pullRequest.html_url,
        kind: "github_pull_request",
        orgId: input.input.run.orgId,
        path: input.input.branch,
        repoId: input.input.run.repoId,
        runId: input.input.run.id,
        title: `GitHub PR #${input.pullRequest.number}`,
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "github.pull_request_opened",
        actorType: "github_app",
        metadata: JSON.stringify({
          branch: input.input.branch,
          changedFiles: input.input.changedFiles,
          prNumber: input.pullRequest.number,
          prUrl: input.pullRequest.html_url,
        }),
        orgId: input.input.run.orgId,
        repoId: input.input.run.repoId,
        runId: input.input.run.id,
        target: input.input.run.repo.fullName,
      },
    }),
  ]);

  return {
    alreadyExists: false,
    branch: input.input.branch,
    path: input.input.branch,
    prUrl: input.pullRequest.html_url,
    runId: input.input.run.id,
  };
}

async function findOpenPullRequestForBranch(input: { branch: string; repo: string; token: string }) {
  const owner = input.repo.split("/")[0];
  if (!owner) return null;
  const pulls = await githubRequest<GitHubPullRequestListItem[]>({
    method: "GET",
    path: `/repos/${input.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.branch}`)}`,
    token: input.token,
  });

  return pulls[0] ?? null;
}

async function githubRequest<T = unknown>(input: {
  body?: unknown;
  method: "GET" | "POST";
  path: string;
  token: string;
}): Promise<T> {
  let response: Response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`https://api.github.com${input.path}`, {
        body: input.body ? JSON.stringify(input.body) : undefined,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        method: input.method,
      });
      break;
    } catch (error) {
      if (attempt === 3) {
        const message = error instanceof Error ? `${error.message}${error.cause ? `; cause=${String(error.cause)}` : ""}` : "fetch failed";
        throw new Error(`GitHub ${input.method} ${input.path} network failed after ${attempt} attempts: ${message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }

  if (!response!.ok) {
    throw new Error(`GitHub ${input.method} ${input.path} failed: ${response!.status} ${await response!.text()}`);
  }

  return (await response!.json()) as T;
}

function parseRunInput(input: string): { installationId?: string } {
  try {
    return JSON.parse(input) as { installationId?: string };
  } catch {
    return {};
  }
}

function parseWorkspacePatch(content: string | undefined):
  | {
      branch: string;
      changedFiles?: string[];
      prBody?: string;
      prTitle?: string;
      pushed: boolean;
    }
  | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as {
      branch?: string;
      changedFiles?: string[];
      prBody?: string;
      prTitle?: string;
      pushed?: boolean;
    };
    if (!parsed.branch || !parsed.pushed) return null;
    return {
      branch: parsed.branch,
      changedFiles: parsed.changedFiles,
      prBody: parsed.prBody,
      prTitle: parsed.prTitle,
      pushed: parsed.pushed,
    };
  } catch {
    return null;
  }
}
