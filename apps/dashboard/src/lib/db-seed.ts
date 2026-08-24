import "dotenv/config";
import { prisma } from "./prisma";

async function main() {
  const orgSlug = process.env.RONIN_SEED_ORG_SLUG ?? "acme";
  const orgName = process.env.RONIN_SEED_ORG_NAME ?? "Acme Protocol";
  const githubOrgLogin = process.env.RONIN_SEED_GITHUB_ORG ?? orgSlug;
  const repoFullName = process.env.RONIN_SEED_REPO ?? `${githubOrgLogin}/protocol-sdk`;

  const org = await prisma.org.upsert({
    where: { slug: orgSlug },
    update: {
      githubOrgLogin,
    },
    create: {
      name: orgName,
      slug: orgSlug,
      githubOrgLogin,
    },
  });

  const developmentIdentity = await prisma.userIdentity.upsert({
    where: { provider_providerAccountId: { provider: "development", providerAccountId: "local" } },
    update: {},
    create: {
      provider: "development",
      providerAccountId: "local",
      login: "development",
      user: { create: { displayName: "Development Operator" } },
    },
  });
  await prisma.orgMembership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: developmentIdentity.userId } },
    update: { status: "active" },
    create: { orgId: org.id, userId: developmentIdentity.userId, role: "owner" },
  });

  const repo = await prisma.repository.upsert({
    where: {
      orgId_fullName: {
        orgId: org.id,
        fullName: repoFullName,
      },
    },
    update: {
      watchedEnabled: true,
      capabilities: "docs,pr_review,support_answers,try_fix,auto_report_pr",
    },
    create: {
      orgId: org.id,
      fullName: repoFullName,
      defaultBranch: "main",
      watchedEnabled: true,
      capabilities: "docs,pr_review,support_answers,try_fix,auto_report_pr",
    },
  });

  const channel = await prisma.channel.upsert({
    where: {
      platform_platformTeamId_platformChannelId: {
        platform: "local",
        platformTeamId: "ronin-dev",
        platformChannelId: "demo-local",
      },
    },
    update: {
      orgId: org.id,
      defaultRepoId: repo.id,
    },
    create: {
      orgId: org.id,
      defaultRepoId: repo.id,
      platform: "local",
      platformTeamId: "ronin-dev",
      platformChannelId: "demo-local",
      displayName: "Local Demo Channel",
    },
  });
  await prisma.channelRepository.upsert({
    where: { channelId_repoId: { channelId: channel.id, repoId: repo.id } },
    update: { orgId: org.id },
    create: { channelId: channel.id, repoId: repo.id, orgId: org.id },
  });

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      repoId: repo.id,
      actorType: "system",
      action: "seed.local_workspace",
      target: repoFullName,
    },
  });

  console.log(`Seeded ${org.slug} / ${repo.fullName}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
