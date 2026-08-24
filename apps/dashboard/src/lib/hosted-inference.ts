import { prisma } from "./prisma";

const DEFAULT_MODEL = "gpt-5-mini";

export class HostedInferenceLimitError extends Error {}

export type HostedInferenceLimits = {
  userPerMinute: number;
  userPerDay: number;
  workspacePerDay: number;
  workspaceConcurrency: number;
};

export async function ensureSlackInstallation(teamId: string, teamName?: string) {
  if (!teamId || teamId === "unknown-team") throw new Error("Slack team identity is required.");
  return prisma.slackInstallation.upsert({
    where: { teamId },
    create: { teamId, teamName },
    update: { lastSeenAt: new Date(), ...(teamName ? { teamName } : {}) },
    include: { org: true },
  });
}

export async function reserveHostedInference(input: {
  installationId: string;
  actorId: string;
  requestId: string;
  model?: string;
  limits?: HostedInferenceLimits;
}) {
  const limits = input.limits ?? hostedInferenceLimits();
  const now = new Date();
  const minuteAgo = new Date(now.getTime() - 60_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const activeAfter = new Date(now.getTime() - 120_000);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hosted:${input.installationId}`}))`;

    const existing = await tx.hostedInferenceUsage.findUnique({
      where: {
        slackInstallationId_requestId: {
          slackInstallationId: input.installationId,
          requestId: input.requestId,
        },
      },
    });
    if (existing) return existing;

    const [userMinute, userDay, workspaceDay, active] = await Promise.all([
      tx.hostedInferenceUsage.count({
        where: { slackInstallationId: input.installationId, actorId: input.actorId, createdAt: { gte: minuteAgo } },
      }),
      tx.hostedInferenceUsage.count({
        where: { slackInstallationId: input.installationId, actorId: input.actorId, createdAt: { gte: dayAgo } },
      }),
      tx.hostedInferenceUsage.count({
        where: { slackInstallationId: input.installationId, createdAt: { gte: dayAgo } },
      }),
      tx.hostedInferenceUsage.count({
        where: { slackInstallationId: input.installationId, status: "running", createdAt: { gte: activeAfter } },
      }),
    ]);

    if (userMinute >= limits.userPerMinute) throw new HostedInferenceLimitError("Per-minute hosted inference limit reached.");
    if (userDay >= limits.userPerDay) throw new HostedInferenceLimitError("Daily user hosted inference limit reached.");
    if (workspaceDay >= limits.workspacePerDay) throw new HostedInferenceLimitError("Daily workspace hosted inference limit reached.");
    if (active >= limits.workspaceConcurrency) throw new HostedInferenceLimitError("Workspace hosted inference is busy. Try again shortly.");

    return tx.hostedInferenceUsage.create({
      data: {
        slackInstallationId: input.installationId,
        actorId: input.actorId,
        requestId: input.requestId,
        model: input.model ?? hostedInferenceModel(),
        status: "running",
      },
    });
  });
}

export async function runHostedInference(input: {
  installationId: string;
  actorId: string;
  requestId: string;
  system: string;
  prompt: string;
}) {
  const model = hostedInferenceModel();
  const usage = await reserveHostedInference({ ...input, model });
  if (usage.status === "completed") {
    throw new Error("Hosted inference request was already completed.");
  }

  try {
    const apiKey = process.env.RONIN_HOSTED_LLM_API_KEY;
    if (!apiKey) throw new Error("Hosted inference is not configured.");
    const response = await fetch(process.env.RONIN_HOSTED_LLM_URL ?? "https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: input.system },
          { role: "user", content: truncatePrompt(input.prompt, maxPromptChars()) },
        ],
        max_output_tokens: positiveInt("RONIN_HOSTED_MAX_OUTPUT_TOKENS", 800),
      }),
      signal: AbortSignal.timeout(positiveInt("RONIN_HOSTED_TIMEOUT_MS", 30_000)),
    });
    const payload = (await response.json().catch(() => null)) as HostedResponse | null;
    if (!response.ok) throw new Error(`Hosted inference failed with HTTP ${response.status}.`);
    const reply = extractHostedText(payload);
    if (!reply) throw new Error("Hosted inference returned no text.");

    await prisma.hostedInferenceUsage.update({
      where: { id: usage.id },
      data: {
        status: "completed",
        inputTokens: payload?.usage?.input_tokens,
        outputTokens: payload?.usage?.output_tokens,
        completedAt: new Date(),
      },
    });
    return {
      reply,
      usageId: usage.id,
      config: { harness: "hosted", model, provider: "openai-compatible", reasoning: undefined },
    };
  } catch (error) {
    await prisma.hostedInferenceUsage.update({
      where: { id: usage.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 1000) : "Hosted inference failed.",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}

export function extractHostedText(payload: HostedResponse | null) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  return payload?.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function hostedInferenceLimits(): HostedInferenceLimits {
  return {
    userPerMinute: positiveInt("RONIN_HOSTED_USER_REQUESTS_PER_MINUTE", 5),
    userPerDay: positiveInt("RONIN_HOSTED_USER_REQUESTS_PER_DAY", 25),
    workspacePerDay: positiveInt("RONIN_HOSTED_WORKSPACE_REQUESTS_PER_DAY", 200),
    workspaceConcurrency: positiveInt("RONIN_HOSTED_WORKSPACE_CONCURRENCY", 2),
  };
}

function hostedInferenceModel() {
  return process.env.RONIN_HOSTED_MODEL?.trim() || DEFAULT_MODEL;
}

function maxPromptChars() {
  return positiveInt("RONIN_HOSTED_MAX_PROMPT_CHARS", 16_000);
}

function truncatePrompt(prompt: string, limit: number) {
  if (prompt.length <= limit) return prompt;
  const marker = "\n\n[Earlier context truncated]\n\n";
  const head = Math.min(4_000, Math.floor((limit - marker.length) / 2));
  return prompt.slice(0, head) + marker + prompt.slice(-(limit - head - marker.length));
}

function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

type HostedResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};
