import { afterAll, describe, expect, test } from "bun:test";
import { authorizeSlackActor, permissions, roleHasPermission } from "./authorization";
import { prisma } from "./prisma";

const suffix = crypto.randomUUID();
const orgIds: string[] = [];

if (process.env.DATABASE_URL) {
  afterAll(async () => {
    await prisma.org.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { identities: { some: { providerAccountId: { contains: suffix } } } } });
    await prisma.$disconnect();
  });
}

describe("tenant authorization", () => {
  test("roles grant only intended permissions", () => {
    expect(roleHasPermission("owner", permissions.membersManage)).toBe(true);
    expect(roleHasPermission("member", permissions.runsExecute)).toBe(true);
    expect(roleHasPermission("member", permissions.membersManage)).toBe(false);
    expect(roleHasPermission("external", permissions.supportExternal)).toBe(true);
    expect(roleHasPermission("external", permissions.dashboardRead)).toBe(false);
  });

  test("Slack membership and database tenant boundaries fail closed", async () => {
    if (!process.env.DATABASE_URL) return;
    const [orgA, orgB] = await Promise.all([
      prisma.org.create({ data: { name: `A ${suffix}`, slug: `a-${suffix}` } }),
      prisma.org.create({ data: { name: `B ${suffix}`, slug: `b-${suffix}` } }),
    ]);
    orgIds.push(orgA.id, orgB.id);

    const member = await authorizeSlackActor({
      orgId: orgA.id,
      appTeamId: `T-${suffix}`,
      profileTeamId: `T-${suffix}`,
      userId: `U-${suffix}`,
      displayName: "Member",
      isGuest: false,
      accessMode: "internal",
    });
    expect(member.role).toBe("member");
    await expect(
      authorizeSlackActor({
        orgId: orgA.id,
        appTeamId: `T-${suffix}`,
        profileTeamId: `EXT-${suffix}`,
        userId: `G-${suffix}`,
        displayName: "Guest",
        isGuest: true,
        accessMode: "internal",
      }),
    ).rejects.toThrow("not authorized");
    const external = await authorizeSlackActor({
      orgId: orgA.id,
      appTeamId: `T-${suffix}`,
      profileTeamId: `EXT-${suffix}`,
      userId: `E-${suffix}`,
      displayName: "External",
      isGuest: true,
      accessMode: "external",
    });
    expect(external.role).toBe("external");

    const [repoA, repoB, channelA] = await Promise.all([
      prisma.repository.create({ data: { orgId: orgA.id, fullName: `a/${suffix}` } }),
      prisma.repository.create({ data: { orgId: orgB.id, fullName: `b/${suffix}` } }),
      prisma.channel.create({ data: { orgId: orgA.id, platform: "test", platformChannelId: `C-${suffix}` } }),
    ]);
    await expect(
      Promise.resolve(prisma.channelRepository.create({ data: { channelId: channelA.id, repoId: repoB.id, orgId: orgA.id } })),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(prisma.run.create({
        data: {
          id: `cross-${suffix}`,
          orgId: orgB.id,
          repoId: repoB.id,
          actorUserId: member.userId,
          kind: "test",
          status: "queued",
          input: "{}",
        },
      })),
    ).rejects.toThrow();
    await prisma.channelRepository.create({ data: { channelId: channelA.id, repoId: repoA.id, orgId: orgA.id } });
  });
});
