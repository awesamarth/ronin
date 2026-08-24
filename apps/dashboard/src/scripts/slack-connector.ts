import "dotenv/config";

import { App } from "@slack/bolt";
import { recordInboundMessage, recordOutboundMessage } from "../lib/conversations";
import { ensureSlackInstallation, HostedInferenceLimitError } from "../lib/hosted-inference";
import { DuplicateMessageDelivery, ingestSupportMessage } from "../lib/message-ingest";
import { ingestOrgRoninMessage } from "../lib/org-ronin";
import { prisma } from "../lib/prisma";
import { answerPublicRoninMessage } from "../lib/public-ronin";
import { withSlackExecutionFooter } from "../lib/slack-execution-footer";

type SlackMessageEvent = {
  bot_id?: string;
  channel: string;
  channel_type?: string;
  subtype?: string;
  team?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  user?: string;
};

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

if (!botToken) throw new Error("SLACK_BOT_TOKEN is required.");
if (!appToken) throw new Error("SLACK_APP_TOKEN is required for Socket Mode.");

const app = new App({
  appToken,
  socketMode: true,
  token: botToken,
});

app.event("app_mention", async ({ client, context, event }) => {
  await handleSlackMessage({ client, event: event as SlackMessageEvent, mode: "mention", teamId: context.teamId });
});

app.event("message", async ({ client, context, event }) => {
  const message = event as SlackMessageEvent;
  if (message.channel_type !== "im") return;
  await handleSlackMessage({ client, event: message, mode: "dm", teamId: context.teamId });
});

async function handleSlackMessage(input: {
  client: App["client"];
  event: SlackMessageEvent;
  mode: "dm" | "mention";
  teamId?: string;
}) {
  const { client, event, mode } = input;

  if (!event.text?.trim()) return;
  if (!event.channel || !event.user) return;
  if (event.bot_id || event.subtype) return;

  const teamId = input.teamId ?? event.team ?? process.env.SLACK_TEAM_ID ?? "unknown-team";

  try {
    const installation = await ensureSlackInstallation(teamId);
    if (mode === "dm") {
      const externalMessageId = event.ts ?? crypto.randomUUID();
      const threadId = event.thread_ts ?? externalMessageId;
      if (installation.orgId) {
        const userName = await getUserName(client, event.user);
        const result = await ingestOrgRoninMessage({
          orgId: installation.orgId,
          teamId,
          channelId: event.channel,
          threadId,
          messageId: externalMessageId,
          userId: event.user,
          userName,
          text: event.text,
        });
        const reply = withSlackExecutionFooter(result.reply, result.config);
        const posted = await client.chat.postMessage({ channel: event.channel, text: reply, thread_ts: threadId });
        await persistOutboundMessage({
          conversationId: result.conversationId,
          externalMessageId: posted.ts ?? `ronin:${result.runId}`,
          content: reply,
          channelId: event.channel,
        });
        console.log(JSON.stringify({ event: "slack.org_dm_answered", teamId, orgId: installation.orgId, runId: result.runId }));
        return;
      }

      const { conversation, isNew } = await recordInboundMessage({
        platform: "slack",
        platformTeamId: teamId,
        platformChannelId: event.channel,
        platformThreadId: threadId,
        externalMessageId,
        content: event.text,
        actorId: event.user,
      });
      if (!isNew) {
        console.log(JSON.stringify({ event: "slack.duplicate_ignored", channelId: event.channel }));
        return;
      }
      const result = await answerPublicRoninMessage({
        message: event.text,
        conversationId: conversation.id,
        eventId: externalMessageId,
        installationId: installation.id,
        actorId: event.user,
      });
      const reply = withSlackExecutionFooter(result.reply, result.config);
      const posted = await client.chat.postMessage({
        channel: event.channel,
        text: reply,
        thread_ts: threadId,
      });
      await persistOutboundMessage({
        conversationId: conversation.id,
        externalMessageId: posted.ts ?? `ronin:${externalMessageId}`,
        content: reply,
        channelId: event.channel,
      });
      console.log(JSON.stringify({ event: "slack.public_answered", teamId, channelId: event.channel }));
      return;
    }

    const [channelName, userName] = await Promise.all([
      getChannelName(client, event.channel),
      getUserName(client, event.user),
    ]);

    const result = await ingestSupportMessage({
      platform: "slack",
      platformTeamId: teamId,
      channelId: event.channel,
      channelName,
      userId: event.user,
      userName,
      messageId: event.ts,
      threadId: event.thread_ts ?? event.ts,
      text: stripBotMention(event.text),
    });

    const reply = withSlackExecutionFooter(result.reply, result.executionConfig);
    const posted = await client.chat.postMessage({
      channel: event.channel,
      text: reply,
      thread_ts: event.thread_ts ?? event.ts,
    });
    await persistOutboundMessage({
      conversationId: result.conversationId,
      externalMessageId: posted.ts ?? `ronin:${result.runId}`,
      content: reply,
      channelId: event.channel,
    });

    console.log(
      JSON.stringify({
        event: "slack.support_answered",
        mode,
        teamId,
        channelId: event.channel,
        runId: result.runId,
        repo: result.context.repo,
        runnerBackend: result.runnerBackend,
      }),
    );
  } catch (error) {
    if (error instanceof DuplicateMessageDelivery) {
      console.log(JSON.stringify({ event: "slack.duplicate_ignored", channelId: event.channel }));
      return;
    }
    if (error instanceof HostedInferenceLimitError) {
      console.warn(JSON.stringify({ event: "slack.hosted_limit_reached", teamId, channelId: event.channel, error: error.message }));
      await client.chat.postMessage({
        channel: event.channel,
        text: "Ronin’s hosted inference limit has been reached. Please try again later or ask the workspace admin to review the plan.",
        thread_ts: event.thread_ts ?? event.ts,
      });
      return;
    }
    const message = error instanceof Error ? error.message : "Ronin Slack connector failed.";
    console.error(JSON.stringify({ event: "slack.support_failed", channelId: event.channel, error: message }));
    await client.chat.postMessage({
      channel: event.channel,
      text: "Ronin could not process this message right now. The failure has been logged for maintainers.",
      thread_ts: event.thread_ts ?? event.ts,
    });
  }
}

function stripBotMention(text: string) {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

async function persistOutboundMessage(input: {
  conversationId: string;
  externalMessageId: string;
  content: string;
  channelId: string;
}) {
  try {
    await recordOutboundMessage(input);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "slack.reply_persistence_failed",
        channelId: input.channelId,
        error: error instanceof Error ? error.message : "Slack reply persistence failed.",
      }),
    );
  }
}

async function getChannelName(client: App["client"], channel: string) {
  try {
    const response = await client.conversations.info({ channel });
    return response.channel?.name ? `#${response.channel.name}` : channel;
  } catch {
    return channel;
  }
}

async function getUserName(client: App["client"], user: string) {
  try {
    const response = await client.users.info({ user });
    const profile = response.user?.profile;
    return profile?.display_name || profile?.real_name || response.user?.name || user;
  } catch {
    return user;
  }
}

async function main() {
  console.log("Starting Ronin Slack connector in Socket Mode...");
  await app.start();
  console.log("Ronin Slack connector is running in Socket Mode.");
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function shutdown(signal: string) {
  console.log(`Received ${signal}; stopping Ronin Slack connector.`);
  await app.stop();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
