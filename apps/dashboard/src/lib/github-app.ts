import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "./prisma";

export function createGitHubAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("GITHUB_APP_ID is not configured.");

  const privateKey = readGitHubPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey, "base64url");

  return `${signingInput}.${signature}`;
}

export async function createInstallationToken(installationId: string) {
  const jwt = createGitHubAppJwt();
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to create GitHub installation token: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as {
    token: string;
    expires_at: string;
  };
}

export async function getInstallationRepositories(installationId: string) {
  const { token } = await createInstallationToken(installationId);
  const response = await fetch("https://api.github.com/installation/repositories", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to list GitHub installation repositories: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as {
    repositories: Array<{
      id: number;
      full_name: string;
      default_branch: string;
    }>;
  };
}

export async function syncGitHubInstallation(installationId: string, userId: string) {
  const verifiedAccess = await prisma.gitHubInstallationAccess.findUnique({
    where: { userId_installationId: { userId, installationId } },
  });
  if (!verifiedAccess) throw new Error("GitHub installation access has not been verified for this operator.");

  const { repositories } = await getInstallationRepositories(installationId);
  const orgLogin = repositories[0]?.full_name.split("/")[0] ?? "unknown-github-account";
  const existingOrg =
    (await prisma.org.findUnique({ where: { githubInstallationId: installationId } })) ??
    (await prisma.org.findUnique({ where: { githubOrgLogin: orgLogin } })) ??
    (await prisma.org.findUnique({ where: { slug: orgLogin.toLowerCase() } }));
  if (existingOrg) {
    const membership = await prisma.orgMembership.findUnique({ where: { orgId_userId: { orgId: existingOrg.id, userId } } });
    const hasMembers = (await prisma.orgMembership.count({ where: { orgId: existingOrg.id } })) > 0;
    if (hasMembers && (!membership || membership.status !== "active" || (membership.role !== "owner" && membership.role !== "admin"))) {
      throw new Error("Organization administrator permission is required to sync this existing installation.");
    }
  }
  const org = existingOrg
    ? await prisma.org.update({
        where: { id: existingOrg.id },
        data: {
          githubInstallationId: installationId,
          githubOrgLogin: orgLogin,
          name: orgLogin,
          slug: orgLogin.toLowerCase(),
        },
      })
    : await prisma.org.create({
        data: {
          githubInstallationId: installationId,
          githubOrgLogin: orgLogin,
          name: orgLogin,
          slug: orgLogin.toLowerCase(),
        },
      });

  const existingMembership = await prisma.orgMembership.findUnique({ where: { orgId_userId: { orgId: org.id, userId } } });
  if (!existingMembership) {
    const membershipCount = await prisma.orgMembership.count({ where: { orgId: org.id, status: "active" } });
    await prisma.orgMembership.upsert({
      where: { orgId_userId: { orgId: org.id, userId } },
      create: { orgId: org.id, userId, role: membershipCount === 0 ? "owner" : "member" },
      update: {},
    });
  }
  await prisma.user.update({ where: { id: userId }, data: { lastActiveOrgId: org.id } });

  const onboardingRunIds: string[] = [];

  for (const repo of repositories) {
    const existingRepo = await prisma.repository.findUnique({
      where: {
        orgId_fullName: {
          orgId: org.id,
          fullName: repo.full_name,
        },
      },
    });
    const repository = await prisma.repository.upsert({
      where: {
        orgId_fullName: {
          orgId: org.id,
          fullName: repo.full_name,
        },
      },
      update: {
        githubRepoId: String(repo.id),
        defaultBranch: repo.default_branch,
        watchedEnabled: true,
        capabilities: "docs,pr_review,support_answers,try_fix,auto_report_pr",
      },
      create: {
        orgId: org.id,
        githubRepoId: String(repo.id),
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
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

    if (!existingRepo && !existingOnboardingRun) {
      const run = await prisma.run.create({
        data: {
          id: `github-repository-onboarded-${Date.now()}-${String(repo.id)}`,
          orgId: org.id,
          repoId: repository.id,
          kind: "github.repository_onboarded",
          status: "queued",
          input: JSON.stringify({
            eventName: "repository_onboarded",
            installationId,
            repo: repo.full_name,
            source: "github.installation_sync",
          }),
          summary: `Repository ${repo.full_name} was added to Ronin. Ronin should inspect the repo and propose useful docs, changelog, example, or support-knowledge updates.`,
        },
      });
      onboardingRunIds.push(run.id);
    }
  }

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      actorType: "github_app",
      actorId: installationId,
      action: "github.installation_sync",
      target: org.githubOrgLogin,
      metadata: JSON.stringify({ onboardingRunIds, repositories: repositories.map((repo) => repo.full_name) }),
    },
  });

  return { onboardingRunIds, org, repositories };
}

function readGitHubPrivateKey() {
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    || (process.env.GITHUB_APP_PRIVATE_KEY_PATH ? readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8") : "");
  if (!privateKey) throw new Error("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH is required.");
  return privateKey.replace(/\\n/g, "\n");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}
