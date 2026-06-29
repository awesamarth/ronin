import "dotenv/config";

import { ingestSupportMessage } from "../lib/message-ingest";
import { prisma } from "../lib/prisma";

type TelegramUser = {
  first_name?: string;
  id: number;
  is_bot?: boolean;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  title?: string;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
};

type TelegramMessage = {
  chat: TelegramChat;
  from?: TelegramUser;
  message_id: number;
  message_thread_id?: number;
  text?: string;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  update_id: number;
};

type TelegramResponse<T> = {
  description?: string;
  ok: boolean;
  result: T;
};

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const configuredBotUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");

if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is required.");

const apiBaseUrl = `https://api.telegram.org/bot${botToken}`;
let isShuttingDown = false;
let offset = 0;
let botUsername = configuredBotUsername;

async function telegramApi<T>(method: string, body?: Record<string, unknown>): Promise<TelegramResponse<T>> {
  const response = await fetch(`${apiBaseUrl}/${method}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : undefined,
    method: body ? "POST" : "GET",
  });

  const payload = (await response.json()) as TelegramResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? `Telegram ${method} failed.`);
  }

  return payload;
}

async function main() {
  const me = await telegramApi<TelegramUser>("getMe");
  botUsername = me.result.username ?? botUsername;

  console.log(
    JSON.stringify({
      botId: me.result.id,
      botUsername,
      event: "telegram.connector_started",
    }),
  );

  while (!isShuttingDown) {
    await pollOnce();
  }
}

async function pollOnce() {
  try {
    const updates = await telegramApi<TelegramUpdate[]>("getUpdates", {
      allowed_updates: ["message"],
      offset,
      timeout: 30,
    });

    for (const update of updates.result) {
      offset = update.update_id + 1;
      await handleUpdate(update);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram polling failed.";
    console.error(JSON.stringify({ error: message, event: "telegram.poll_failed" }));
    await sleep(message.includes("Conflict:") ? 15000 : 2000);
  }
}

async function handleUpdate(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.text?.trim()) return;
  if (message.from?.is_bot) return;

  const parsedText = parseMessageText(message);
  if (!parsedText) return;

  const chatContextId = getChatContextId(message);
  const chatName = getChatName(message);
  const userId = String(message.from?.id ?? "unknown-user");
  const userName = getUserName(message.from);

  try {
    const result = await ingestSupportMessage({
      channelId: chatContextId,
      channelName: chatName,
      platform: "telegram",
      platformTeamId: botUsername ?? "",
      text: parsedText,
      userId,
      userName,
    });

    await telegramApi("sendMessage", {
      chat_id: message.chat.id,
      message_thread_id: message.message_thread_id,
      reply_to_message_id: message.message_id,
      text: result.reply,
    });

    console.log(
      JSON.stringify({
        chatId: chatContextId,
        event: "telegram.support_answered",
        repo: result.context.repo,
        runId: result.runId,
        runnerBackend: result.runnerBackend,
      }),
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : "Ronin Telegram connector failed.";
    console.error(JSON.stringify({ chatId: chatContextId, error: text, event: "telegram.support_failed" }));
    await telegramApi("sendMessage", {
      chat_id: message.chat.id,
      message_thread_id: message.message_thread_id,
      reply_to_message_id: message.message_id,
      text: `Ronin failed to answer this one: ${text}`,
    });
  }
}

function parseMessageText(message: TelegramMessage) {
  const text = message.text?.trim();
  if (!text) return null;

  if (message.chat.type === "private") {
    return stripBotCommand(text);
  }

  const commandMatch = text.match(/^\/ronin(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if (commandMatch) return commandMatch[1]?.trim() || "Help with this repository.";

  if (botUsername) {
    const mention = new RegExp(`@${escapeRegExp(botUsername)}\\b`, "i");
    if (mention.test(text)) return text.replace(mention, "").trim();
  }

  return null;
}

function stripBotCommand(text: string) {
  return text.replace(/^\/ronin(?:@\w+)?\s*/i, "").trim() || text;
}

function getChatContextId(message: TelegramMessage) {
  return message.message_thread_id ? `${message.chat.id}:${message.message_thread_id}` : String(message.chat.id);
}

function getChatName(message: TelegramMessage) {
  const title = message.chat.title ?? message.chat.username ?? String(message.chat.id);
  return message.message_thread_id ? `${title} / topic ${message.message_thread_id}` : title;
}

function getUserName(user?: TelegramUser) {
  if (!user) return undefined;
  if (user.username) return `@${user.username}`;
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || String(user.id);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function shutdown(signal: string) {
  isShuttingDown = true;
  console.log(`Received ${signal}; stopping Ronin Telegram connector.`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
