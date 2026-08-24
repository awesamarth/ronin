import { prisma } from "./prisma";

type ConversationMessageInput = {
  platform: string;
  platformTeamId?: string;
  platformChannelId: string;
  platformThreadId: string;
  externalMessageId: string;
  content: string;
  actorId?: string;
  actorName?: string;
  actorUserId?: string;
  orgId?: string;
  channelId?: string;
  run?: {
    id: string;
    orgId: string;
    repoId?: string;
    kind: string;
    input: string;
    summary?: string;
    authorizedAction?: string;
    authorization?: string;
  };
};

export async function recordInboundMessage(input: ConversationMessageInput) {
  return prisma.$transaction(async (tx) => {
    let conversation = await tx.conversation.upsert({
      where: {
        platform_platformTeamId_platformChannelId_platformThreadId: {
          platform: input.platform,
          platformTeamId: input.platformTeamId ?? "",
          platformChannelId: input.platformChannelId,
          platformThreadId: input.platformThreadId,
        },
      },
      create: {
        platform: input.platform,
        platformTeamId: input.platformTeamId ?? "",
        platformChannelId: input.platformChannelId,
        platformThreadId: input.platformThreadId,
        scope: input.orgId ? "organization" : "public",
        orgId: input.orgId,
        channelId: input.channelId,
      },
      update: {},
    });

    if (conversation.orgId && conversation.orgId !== input.orgId) {
      throw new Error("Conversation organization does not match the authenticated channel mapping.");
    }
    if (!conversation.orgId && input.orgId) {
      conversation = await tx.conversation.update({
        where: { id: conversation.id },
        data: { scope: "organization", orgId: input.orgId, channelId: input.channelId },
      });
    }

    const [inserted] = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "ConversationMessage" (
        "id", "conversationId", "externalMessageId", "role", "actorId", "actorName", "actorUserId", "content", "createdAt"
      ) VALUES (
        ${crypto.randomUUID()}, ${conversation.id}, ${input.externalMessageId}, 'user',
        ${input.actorId ?? null}, ${input.actorName ?? null}, ${input.actorUserId ?? null}, ${input.content}, NOW()
      )
      ON CONFLICT ("conversationId", "externalMessageId") DO NOTHING
      RETURNING "id"
    `;
    const message = await tx.conversationMessage.findUniqueOrThrow({
      where: {
        conversationId_externalMessageId: {
          conversationId: conversation.id,
          externalMessageId: input.externalMessageId,
        },
      },
    });

    if (
      message.content !== input.content ||
      message.actorId !== (input.actorId ?? null) ||
      message.actorUserId !== (input.actorUserId ?? null)
    ) {
      throw new Error("Duplicate platform message identity has conflicting content or actor.");
    }

    const runData = input.run;
    const run = inserted && runData
      ? await tx.run.create({
          data: {
            id: runData.id,
            orgId: runData.orgId,
            repoId: runData.repoId,
            kind: runData.kind,
            input: runData.input,
            summary: runData.summary,
            actorUserId: input.actorUserId,
            authorizedAction: runData.authorizedAction,
            authorization: runData.authorization,
            conversationId: conversation.id,
            sourceMessageId: message.id,
            status: "running",
            startedAt: new Date(),
          },
        })
      : null;

    return { conversation, message, run, isNew: Boolean(inserted) };
  });
}

export async function recordOutboundMessage(input: {
  conversationId: string;
  externalMessageId: string;
  content: string;
}) {
  const message = await prisma.conversationMessage.upsert({
    where: {
      conversationId_externalMessageId: {
        conversationId: input.conversationId,
        externalMessageId: input.externalMessageId,
      },
    },
    create: {
      conversationId: input.conversationId,
      externalMessageId: input.externalMessageId,
      role: "assistant",
      actorId: "ronin",
      actorName: "Ronin",
      content: input.content,
    },
    update: {},
  });

  if (message.role !== "assistant" || message.content !== input.content) {
    throw new Error("Duplicate outbound message identity has conflicting content.");
  }
  return message;
}
