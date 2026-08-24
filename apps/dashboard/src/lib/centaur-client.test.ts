import { afterEach, test, expect } from "bun:test";
import { buildThreadKey, processSseEvent, runCentaurTask, CentaurError, type SseState } from "./centaur-client";

const emptyState = (): SseState => ({ assistantText: "", terminalEvent: null, errorDetail: "" });

afterEach(() => {
  delete process.env.CENTAUR_API_KEY;
  delete process.env.CENTAUR_API_URL;
  delete process.env.RONIN_HARNESS;
  delete process.env.RONIN_MODEL;
  delete process.env.RONIN_PROVIDER;
  delete process.env.RONIN_REASONING;
});

test("buildThreadKey namespaces with a colon, sanitizes, and stays <=512 bytes", () => {
  const key = buildThreadKey(["workspace", "org/repo name", "run-123"]);
  expect(key).toBe("ronin:workspace-org-repo-name-run-123");
  expect(buildThreadKey(["workspace", "org/repo name", "run-123"])).toBe(key);
  const long = buildThreadKey(["x".repeat(600)]);
  expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(512);
});

test("runCentaurTask posts the contract bodies with URL-encoded thread key and extracts final text", async () => {
  process.env.CENTAUR_API_KEY = "test-key";
  process.env.CENTAUR_API_URL = "http://centaur.test";

  const threadKey = "ronin:support-acme-repo-run-1";
  const encoded = encodeURIComponent(threadKey);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sseBody = [
    `event: session.output.line\ndata: ${JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "ha " } })}`,
    `event: session.output.line\ndata: ${JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "ha " } })}`,
    `event: session.output.line\ndata: ${JSON.stringify({ method: "item/completed", params: { item: { type: "agentMessage", text: "ha ha done" } } })}`,
    `event: session.execution_completed\ndata: {}`,
  ].join("\n\n");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/messages")) return new Response("{}", { status: 200 });
    if (String(url).endsWith("/execute")) {
      return new Response(JSON.stringify({ execution_id: "exec-9" }), { status: 200 });
    }
    if (String(url).includes("/events?")) {
      return new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ sandbox_capabilities: { repo_cache: "none" } }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await runCentaurTask({
      threadKey,
      prompt: "do the thing",
      idempotencyKey: "run-persisted-id",
    });

    // All four routes use the fully encoded thread key.
    const base = "http://centaur.test/api/session";
    expect(calls.map((call) => call.url)).toEqual([
      `${base}/${encoded}`,
      `${base}/${encoded}/messages`,
      `${base}/${encoded}/execute`,
      `${base}/${encoded}/events?execution_id=exec-9&after_event_id=0`,
    ]);
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    }

    const createBody = JSON.parse(calls[0].init.body as string);
    expect(createBody).toEqual({ harness_type: "pi", metadata: { source: "ronin" }, on_harness_conflict: "reject" });

    const messagesBody = JSON.parse(calls[1].init.body as string);
    expect(messagesBody.messages.length).toBe(1);
    const message = messagesBody.messages[0];
    expect(typeof message.client_message_id).toBe("string");
    expect(message.role).toBe("user");
    expect(message.parts).toEqual([{ type: "text", text: "do the thing" }]);
    expect(message.metadata).toEqual({ source: "ronin" });

    const executeBody = JSON.parse(calls[2].init.body as string);
    expect(executeBody.idempotency_key).toBe("run-persisted-id");
    expect(executeBody.metadata).toEqual({ source: "ronin" });
    expect(executeBody.idle_timeout_ms).toBeGreaterThan(0);
    expect(executeBody.max_duration_ms).toBe(executeBody.idle_timeout_ms);
    expect(executeBody.input_lines.length).toBe(1);
    expect(JSON.parse(executeBody.input_lines[0])).toEqual({
      type: "user",
      thread_key: threadKey,
      client_user_message_id: message.client_message_id,
      trace_metadata: { source: "ronin" },
      message: { role: "user", content: [{ type: "text", text: "do the thing" }] },
    });

    // Repeated identical delta is preserved; completed supersedes cleanly.
    expect(result.executionId).toBe("exec-9");
    expect(result.threadKey).toBe(threadKey);
    expect(result.backend).toBe("centaur/pi");
    expect(result.rawOutput).toBe("ha ha done");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session.output.line JSONL stream accumulates deltas and turn/completed items", () => {
  let state = emptyState();
  const line = (payload: unknown) =>
    processSseEvent(`event: session.output.line\ndata: ${JSON.stringify(payload)}`, state);
  state = line({ method: "item/started", params: {} });
  state = line({ method: "item/agentMessage/delta", params: { delta: "Hello " } });
  state = line({ method: "item/agentMessage/delta", params: { delta: "World" } });
  expect(state.assistantText).toBe("Hello World");
  state = line({
    method: "turn/completed",
    params: { items: [{ type: "agentMessage", text: "Hello World" }, { type: "other" }] },
  });
  expect(state.assistantText).toBe("Hello World");
  state = line({ method: "turn/completed", params: { items: [{ type: "agentMessage", text: "Next segment" }] } });
  expect(state.terminalEvent).toBeNull();
});

test("assistant-style frames with message.content arrays supersede deltas", () => {
  let state = emptyState();
  state = processSseEvent(
    `event: session.output.line\ndata: ${JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "Hel" } })}`,
    state,
  );
  state = processSseEvent(
    `event: session.output.line\ndata: ${JSON.stringify({
      message: { role: "assistant", content: [{ type: "text", text: "Hello there" }] },
    })}`,
    state,
  );
  expect(state.assistantText).toBe("Hello there");
});

test("stream_error and terminal events are handled distinctly with bounded detail", () => {
  let state = emptyState();
  state = processSseEvent(`event: session.stream_error\ndata: ${"boom ".repeat(500)}`, state);
  expect(state.terminalEvent).toBe("stream_error");
  expect(state.errorDetail.length).toBe(1000);

  state = emptyState();
  state = processSseEvent("event: session.execution_failed\ndata: {\"error\":\"harness crashed\"}", state);
  expect(state.terminalEvent).toBe("failed");

  state = emptyState();
  state = processSseEvent("event: session.execution_cancelled\ndata: {}", state);
  expect(state.terminalEvent).toBe("cancelled");

  state = emptyState();
  state = processSseEvent("event: session.started\ndata: {}", state);
  expect(state.terminalEvent).toBeNull();
});

test("runCentaurTask rejects a reported shared repo cache", async () => {
  process.env.CENTAUR_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ sandbox_capabilities: { repo_cache: "all" } }), { status: 200 })) as typeof fetch;
  try {
    await expect(Promise.resolve(runCentaurTask({ threadKey: "ronin:unsafe", prompt: "p" }))).rejects.toThrow(
      "unsafe repository-cache scope",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CentaurError bounds detail and runCentaurTask falls back to random idempotency key", async () => {
  const err = new CentaurError("failed", "x".repeat(5000));
  expect(err.name).toBe("CentaurError");
  expect(err.detail.length).toBe(2000);

  process.env.CENTAUR_API_KEY = "test-key";
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/execute")) return new Response(JSON.stringify({ execution_id: "e" }), { status: 200 });
    if (String(url).endsWith("/events")) {
      throw new Error("stop here");
    }
    return new Response(JSON.stringify({ sandbox_capabilities: { repo_cache: "none" } }), { status: 200 });
  }) as typeof fetch;
  try {
    await runCentaurTask({ threadKey: "ronin:x", prompt: "p" }).catch(() => {});
    const body = JSON.parse(calls.find((c) => c.url.endsWith("/execute"))!.init.body as string);
    expect(typeof body.idempotency_key).toBe("string");
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
