import { runHostedInference } from "./hosted-inference";
import { prisma } from "./prisma";

const PUBLIC_BRIEF = `
Ronin is an agentic solutions engineer for teams, organizations, and enterprises.
It focuses on the work around a changing codebase: explaining products, keeping documentation current, investigating user-reported issues, running checks, identifying root causes, and proposing code, test, example, configuration, or documentation changes through reviewable pull requests.
Ronin combines capabilities associated with documentation agents, coding agents, and company knowledge systems, but stays focused on solutions engineering.
`;

const PUBLIC_SYSTEM = `You are Ronin speaking in an unconnected Slack workspace.
Be conversational, direct, and concise. Continue the conversation naturally instead of repeating an introduction.
You have no company knowledge, repository access, tools, shell, or private information. Answer only from the public product brief and conversation supplied by Ronin. If the user asks for company-specific work, explain that an operator must connect the workspace first.

Public product brief:
${PUBLIC_BRIEF.trim()}`;

export function buildPublicRoninSystemPrompt() {
  return PUBLIC_SYSTEM;
}

export function buildPublicRoninPrompt(message: string, history: Array<{ role: string; content: string }> = []) {
  return `${formatHistory(history)}\n\nCurrent message:\n${message.trim()}`;
}

export async function answerPublicRoninMessage(input: {
  message: string;
  conversationId: string;
  eventId: string;
  installationId: string;
  actorId: string;
}) {
  const history = await prisma.conversationMessage
    .findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      where: { conversationId: input.conversationId, externalMessageId: { not: input.eventId } },
      select: { role: true, content: true },
    })
    .then((messages) => messages.reverse());
  return runHostedInference({
    installationId: input.installationId,
    actorId: input.actorId,
    requestId: `${input.conversationId}:${input.eventId}`,
    system: PUBLIC_SYSTEM,
    prompt: buildPublicRoninPrompt(input.message, history),
  });
}

function formatHistory(history: Array<{ role: string; content: string }>) {
  if (!history.length) return "Conversation history:\nNo earlier messages.";
  return `Conversation history:\n${history.map((message) => `${message.role === "assistant" ? "Ronin" : "User"}: ${message.content.slice(0, 2000)}`).join("\n")}`;
}
