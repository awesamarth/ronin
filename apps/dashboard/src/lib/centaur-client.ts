/**
 * Dependency-free Centaur API client.
 *
 * Uses native fetch, AbortSignal, TextEncoder/TextDecoder, and crypto.randomUUID only.
 * Centaur contract:
 *   POST   /api/session/:encodedThreadKey           create-or-get session
 *   POST   /api/session/:encodedThreadKey/messages  append a user message
 *   POST   /api/session/:encodedThreadKey/execute   start an execution
 *   GET    /api/session/:encodedThreadKey/events?execution_id=...&after_event_id=0  SSE stream
 *
 * The SSE emits `session.output.line` whose data is ONE raw harness JSONL line
 * (`{method, params}`); the SSE itself never emits `item.*` event names.
 */

const CENTAUR_API_URL = () => process.env.CENTAUR_API_URL ?? "http://127.0.0.1:8080";
const CENTAUR_API_KEY = () => process.env.CENTAUR_API_KEY ?? "";
const RONIN_HARNESS = () => process.env.RONIN_HARNESS ?? "pi";
const RONIN_MODEL = () => process.env.RONIN_MODEL;
const RONIN_PROVIDER = () => process.env.RONIN_PROVIDER;
const RONIN_REASONING = () => process.env.RONIN_REASONING;
const CENTAUR_TIMEOUT_MS = () => Number(process.env.CENTAUR_TIMEOUT_MS ?? 600_000);

const MAX_THREAD_KEY_BYTES = 512;

export type CentaurResult = {
  threadKey: string;
  executionId: string;
  rawOutput: string;
  backend: string;
  config: {
    harness: string;
    model?: string;
    provider?: string;
    reasoning?: string;
  };
};

export type CentaurExecutionConfig = {
  harness?: string;
  model?: string | null;
  provider?: string | null;
  reasoning?: string | null;
};

/**
 * Build a deterministic thread key namespaced with a colon (`ronin:<sanitized>`),
 * sanitized to [a-zA-Z0-9_-] and truncated to <=512 UTF-8 bytes. Sanitized
 * output is ASCII, so character length equals byte length.
 */
export function buildThreadKey(parts: string[]): string {
  const rest = parts.map(sanitizeThreadKeyPart).filter(Boolean).join("-");
  const full = `ronin:${rest}`;
  // ponytail: ASCII-safe char slice; switch to byte-aware truncation if the charset ever widens.
  return full.length > MAX_THREAD_KEY_BYTES ? full.slice(0, MAX_THREAD_KEY_BYTES) : full;
}

function sanitizeThreadKeyPart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

/**
 * Run a single Centaur execution: create-or-get session, append one user
 * message, execute idempotently, consume SSE, and return the final assistant
 * text.
 *
 * `idempotencyKey` should be a stable persisted identity for the task (e.g.
 * the Ronin run/message id) so retries reuse the same execution. Callers must
 * not pass prompt hashes or timestamps.
 */
export async function runCentaurTask(input: {
  threadKey: string;
  prompt: string;
  timeoutMs?: number;
  idempotencyKey?: string;
  config?: CentaurExecutionConfig;
  onExecutionStarted?: (execution: { threadKey: string; executionId: string }) => unknown | Promise<unknown>;
}): Promise<CentaurResult> {
  if (!CENTAUR_API_KEY()) throw new Error("CENTAUR_API_KEY is required.");

  const timeoutMs = input.timeoutMs ?? CENTAUR_TIMEOUT_MS();
  const config = resolvedConfig(input.config);
  const controller = new AbortController();
  const timeout = AbortSignal.timeout(timeoutMs);
  // Either our own abort or the timeout signal fires.
  timeout.addEventListener("abort", () => controller.abort(), { once: true });

  const threadKey = input.threadKey.startsWith("ronin:") ? input.threadKey : buildThreadKey([input.threadKey]);
  const baseUrl = CENTAUR_API_URL().replace(/\/+$/, "");
  const encodedKey = encodeURIComponent(threadKey);

  // 1. Create or get session.
  const sessionRes = await fetch(`${baseUrl}/api/session/${encodedKey}`, {
    method: "POST",
    headers: centaurHeaders(),
    body: JSON.stringify({
      harness_type: config.harness,
      metadata: { source: "ronin" },
      on_harness_conflict: "reject",
    }),
    signal: controller.signal,
  });
  if (!sessionRes.ok) {
    throw new CentaurError(`Session create failed: ${sessionRes.status}`, await safeText(sessionRes));
  }

  // 2. Append user message with a unique client id.
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const clientId = stableClientMessageId(idempotencyKey);
  const messageRes = await fetch(`${baseUrl}/api/session/${encodedKey}/messages`, {
    method: "POST",
    headers: centaurHeaders(),
    body: JSON.stringify({
      messages: [
        {
          client_message_id: clientId,
          role: "user",
          parts: [{ type: "text", text: input.prompt }],
          metadata: { source: "ronin" },
        },
      ],
    }),
    signal: controller.signal,
  });
  if (!messageRes.ok) {
    throw new CentaurError(`Message append failed: ${messageRes.status}`, await safeText(messageRes));
  }

  // 3. Execute idempotently under a stable key.
  const execRes = await fetch(`${baseUrl}/api/session/${encodedKey}/execute`, {
    method: "POST",
    headers: centaurHeaders(),
    body: JSON.stringify(executeBody({ clientId, config, idempotencyKey, prompt: input.prompt, timeoutMs, threadKey })),
    signal: controller.signal,
  });
  if (!execRes.ok) {
    throw new CentaurError(`Execute failed: ${execRes.status}`, await safeText(execRes));
  }
  const execBody = (await execRes.json()) as { execution_id?: string };
  const executionId = execBody.execution_id;
  if (!executionId) throw new CentaurError("Execute response missing execution_id.", JSON.stringify(execBody));
  await input.onExecutionStarted?.({ threadKey, executionId });

  // 4. Consume SSE event stream until a terminal event.
  const rawOutput = await consumeSseStream({ baseUrl, encodedKey, executionId, signal: controller.signal, timeoutMs });

  return {
    threadKey,
    executionId,
    rawOutput,
    backend: `centaur/${config.harness}`,
    config,
  };
}

function resolvedConfig(config: CentaurExecutionConfig | undefined) {
  return {
    harness: config?.harness || RONIN_HARNESS(),
    model: config?.model || RONIN_MODEL(),
    provider: config?.provider || RONIN_PROVIDER(),
    reasoning: config?.reasoning || RONIN_REASONING(),
  };
}

function stableClientMessageId(idempotencyKey: string) {
  return `ronin-${idempotencyKey}`.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 240);
}

function executeBody(input: {
  clientId: string;
  config: ReturnType<typeof resolvedConfig>;
  idempotencyKey: string;
  prompt: string;
  threadKey: string;
  timeoutMs: number;
}) {
  const metadata: Record<string, unknown> = { source: "ronin" };
  const line: Record<string, unknown> = {
    type: "user",
    thread_key: input.threadKey,
    client_user_message_id: input.clientId,
    trace_metadata: { source: "ronin" },
    message: { role: "user", content: [{ type: "text", text: input.prompt }] },
  };
  if (input.config.model) {
    metadata.model = input.config.model;
    line.model = input.config.model;
  }
  if (input.config.provider) {
    metadata.provider = input.config.provider;
    line.provider = input.config.provider;
  }
  if (input.config.reasoning) {
    metadata.reasoning = input.config.reasoning;
    line.reasoning = input.config.reasoning;
  }
  return {
    idempotency_key: input.idempotencyKey,
    metadata,
    input_lines: [JSON.stringify(line)],
    idle_timeout_ms: input.timeoutMs,
    max_duration_ms: input.timeoutMs,
  };
}

function centaurHeaders() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${CENTAUR_API_KEY()}`,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Consume the SSE event stream for a Centaur execution.
 *
 * Terminal events are `session.execution_completed`, `session.execution_failed`,
 * `session.execution_cancelled`, and `session.stream_error`.
 */
async function consumeSseStream(input: {
  baseUrl: string;
  encodedKey: string;
  executionId: string;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<string> {
  const url = `${input.baseUrl}/api/session/${input.encodedKey}/events?execution_id=${encodeURIComponent(input.executionId)}&after_event_id=0`;
  const res = await fetch(url, {
    headers: { ...centaurHeaders(), accept: "text/event-stream" },
    signal: input.signal,
  });
  if (!res.ok || !res.body) {
    throw new CentaurError(`Event stream failed: ${res.status}`, await safeText(res));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let state: SseState = { assistantText: "", terminalEvent: null, errorDetail: "" };

  const deadline = Date.now() + input.timeoutMs;

  try {
    while (true) {
      if (Date.now() > deadline) {
        throw new CentaurError("Centaur execution timed out.", `execution_id=${input.executionId}`);
      }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const rawEvent of events) {
        state = processSseEvent(rawEvent, state);
      }
    }
    // Flush a trailing event not terminated by a blank line.
    if (buffer.trim()) state = processSseEvent(buffer, state);
  } finally {
    reader.releaseLock();
  }

  if (state.terminalEvent === "stream_error") {
    throw new CentaurError("Centaur stream error.", state.errorDetail || input.executionId);
  }
  if (state.terminalEvent === "failed") {
    throw new CentaurError("Centaur execution failed.", state.errorDetail || tail(state.assistantText, 1000) || input.executionId);
  }
  if (state.terminalEvent === "cancelled") {
    throw new CentaurError("Centaur execution was cancelled.", state.errorDetail || tail(state.assistantText, 1000) || input.executionId);
  }
  if (state.terminalEvent !== "completed") {
    throw new CentaurError("Centaur execution did not reach a terminal event.", input.executionId);
  }

  return state.assistantText.trim();
}

function tail(value: string, max: number): string {
  return value.length > max ? value.slice(-max) : value;
}

type SseEvent = { event: string; data: string };

export type SseState = { assistantText: string; terminalEvent: string | null; errorDetail: string };

/**
 * Process a single SSE event block and return updated state. Exported for
 * testing without a live Centaur server.
 */
export function processSseEvent(raw: string, state: SseState): SseState {
  const parsed = parseSseEvent(raw);
  if (!parsed) return state;

  const { event, data } = parsed;

  if (event === "session.output.line" && data) {
    return { ...state, assistantText: applyHarnessJsonl(state.assistantText, data) };
  }
  if (event === "session.stream_error" && !state.terminalEvent) {
    return { ...state, terminalEvent: "stream_error", errorDetail: boundErrorDetail(data) };
  }
  if (event === "session.execution_completed" && !state.terminalEvent) {
    return { ...state, terminalEvent: "completed" };
  }
  if (event === "session.execution_failed" && !state.terminalEvent) {
    return { ...state, terminalEvent: "failed", errorDetail: boundErrorDetail(data) };
  }
  if (event === "session.execution_cancelled" && !state.terminalEvent) {
    return { ...state, terminalEvent: "cancelled", errorDetail: boundErrorDetail(data) };
  }
  return state;
}

function boundErrorDetail(data: string): string {
  return data.slice(0, 1000);
}

function parseSseEvent(raw: string): SseEvent | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (!event && !dataLines.length) return null;
  return { event: event || "message", data: dataLines.join("\n") };
}

/**
 * One `session.output.line` data value is one raw harness JSONL line shaped
 * `{method, params}`. Recognized methods:
 *   item/agentMessage/delta -> params.delta is streamed text
 *   item/completed          -> params.item is a finished agentMessage item
 *   turn/completed          -> may carry agentMessage items
 * Assistant-style frames with `message.content` arrays are also supported.
 */
function applyHarnessJsonl(current: string, data: string): string {
  let line: Record<string, unknown>;
  try {
    line = JSON.parse(data) as Record<string, unknown>;
  } catch {
    // Raw non-JSON output line: preserve it verbatim.
    return current ? `${current}\n${data}` : data;
  }
  if (typeof line !== "object" || line === null) return current;

  const method = typeof line.method === "string" ? line.method : "";
  const params = (line.params && typeof line.params === "object" ? line.params : {}) as Record<string, unknown>;

  if (method === "item/agentMessage/delta") {
    return appendDelta(current, stringOrEmpty(params.delta));
  }
  if (method === "item/completed") {
    return supersede(current, agentItemText(params.item));
  }
  if (method === "turn/completed") {
    let next = current;
    for (const container of ["items", "messages"] as const) {
      const entries = params[container];
      if (Array.isArray(entries)) {
        for (const entry of entries) next = supersede(next, agentItemText(entry));
      }
    }
    return supersede(next, agentItemText(params.item));
  }
  // Assistant-style frame without a method envelope.
  return supersede(current, assistantFrameText(line));
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Extract text from a completed harness item when it is an agentMessage. */
function agentItemText(item: unknown): string {
  if (typeof item !== "object" || item === null) return "";
  const record = item as Record<string, unknown>;
  if (record.type !== "agentMessage") return "";
  return itemContentText(record);
}

/** Extract text from an assistant-style frame: `{message:{role,content:[...]}}`. */
function assistantFrameText(line: Record<string, unknown>): string {
  const message = line.message;
  if (typeof message !== "object" || message === null) return "";
  const record = message as Record<string, unknown>;
  if (record.role && record.role !== "assistant" && record.role !== "user") return "";
  return itemContentText(record);
}

/** Shared text extraction: `.text` string or `.content` array of text parts. */
function itemContentText(record: Record<string, unknown>): string {
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        if (typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "text") {
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function appendDelta(current: string, delta: string): string {
  // Never dedupe: legitimate repeated deltas must survive.
  return delta ? current + delta : current;
}

/**
 * Completed text supersedes accumulated deltas when it extends them; if the
 * deltas already cover the completed text, keep what we have. Otherwise the
 * completed message opens a new segment.
 */
function supersede(current: string, text: string): string {
  if (!text) return current;
  if (!current) return text;
  if (text.startsWith(current)) return text;
  if (current.endsWith(text)) return current;
  return `${current}\n${text}`;
}

export class CentaurError extends Error {
  detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = "CentaurError";
    this.detail = detail.slice(0, 2000);
  }
}
