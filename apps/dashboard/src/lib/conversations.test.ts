import { afterAll, describe, expect, test } from "bun:test";
import { recordInboundMessage, recordOutboundMessage } from "./conversations";
import { prisma } from "./prisma";

const suffix = crypto.randomUUID();
const platformTeamId = `team-${suffix}`;
let orgId: string | undefined;

afterAll(async () => {
  if (orgId) await prisma.org.delete({ where: { id: orgId } }).catch(() => {});
  await prisma.conversation.deleteMany({ where: { platformTeamId } });
  await prisma.$disconnect();
});

describe("conversation persistence", () => {
  test("deduplicates messages, isolates threads, and explicitly upgrades public scope", async () => {
    const first = await recordInboundMessage({
      platform: "slack",
      platformTeamId,
      platformChannelId: "D1",
      platformThreadId: "thread-1",
      externalMessageId: "message-1",
      actorId: "user-1",
      content: "hello",
    });
    const duplicate = await recordInboundMessage({
      platform: "slack",
      platformTeamId,
      platformChannelId: "D1",
      platformThreadId: "thread-1",
      externalMessageId: "message-1",
      actorId: "user-1",
      content: "hello",
    });
    const otherThread = await recordInboundMessage({
      platform: "slack",
      platformTeamId,
      platformChannelId: "D1",
      platformThreadId: "thread-2",
      externalMessageId: "message-2",
      actorId: "user-1",
      content: "separate work",
    });

    expect(first.isNew).toBe(true);
    expect(duplicate.isNew).toBe(false);
    expect(duplicate.conversation.id).toBe(first.conversation.id);
    expect(otherThread.conversation.id).not.toBe(first.conversation.id);
    expect(first.conversation.scope).toBe("public");

    const org = await prisma.org.create({ data: { name: `Org ${suffix}`, slug: `org-${suffix}` } });
    orgId = org.id;
    const channel = await prisma.channel.create({
      data: {
        orgId: org.id,
        platform: "slack",
        platformTeamId,
        platformChannelId: "D1",
        displayName: "DM",
      },
    });
    const upgraded = await recordInboundMessage({
      platform: "slack",
      platformTeamId,
      platformChannelId: "D1",
      platformThreadId: "thread-1",
      externalMessageId: "message-3",
      actorId: "user-1",
      content: "connected now",
      orgId: org.id,
      channelId: channel.id,
    });
    await recordOutboundMessage({
      conversationId: upgraded.conversation.id,
      externalMessageId: "reply-1",
      content: "connected",
    });

    expect(upgraded.conversation.id).toBe(first.conversation.id);
    expect(upgraded.conversation.scope).toBe("organization");
    expect(upgraded.conversation.orgId).toBe(org.id);
    expect(await prisma.conversationMessage.count({ where: { conversationId: first.conversation.id } })).toBe(3);
  });
});
