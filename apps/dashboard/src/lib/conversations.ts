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
  orgId?: string;
  channelId?: string;
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

    const existingMessage = await tx.conversationMessage.findUnique({
      where: {
        conversationId_externalMessageId: {
          conversationId: conversation.id,
          externalMessageId: input.externalMessageId,
        },
      },
    });
    const message = await tx.conversationMessage.upsert({
      where: {
        conversationId_externalMessageId: {
          conversationId: conversation.id,
          externalMessageId: input.externalMessageId,
        },
      },
      create: {
        conversationId: conversation.id,
        externalMessageId: input.externalMessageId,
        role: "user",
        actorId: input.actorId,
        actorName: input.actorName,
        content: input.content,
      },
      update: {},
    });

    if (message.content !== input.content || message.actorId !== (input.actorId ?? null)) {
      throw new Error("Duplicate platform message identity has conflicting content or actor.");
    }

    return { conversation, message, isNew: !existingMessage };
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
