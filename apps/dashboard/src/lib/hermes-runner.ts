import { execFileSync } from "node:child_process";

export type HermesRunnerResult = {
  backend: "nemohermes" | "local";
  rawOutput: string;
};

export async function runHermesTask(input: { prompt: string; cwd: string; skills?: string[]; timeoutMs?: number }): Promise<HermesRunnerResult> {
  if (process.env.RONIN_HERMES_RUNNER !== "local") {
    try {
      return await runNemoHermesTask(input.prompt);
    } catch {
      if (process.env.RONIN_HERMES_RUNNER === "nemohermes") {
        throw new Error("NemoHermes runner is unavailable and fallback is disabled.");
      }
    }
  }

  return runLocalHermesTask(input);
}

async function runNemoHermesTask(prompt: string): Promise<HermesRunnerResult> {
  const baseUrl = process.env.NEMOHERMES_BASE_URL ?? "http://127.0.0.1:8642/v1";
  const model = process.env.NEMOHERMES_MODEL ?? "default";
  console.log(`[ronin] nemohermes request ${baseUrl}/chat/completions model=${model}`);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are Hermes running inside Ronin's sandboxed execution lane. Return only the requested final output.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(Number(process.env.NEMOHERMES_TIMEOUT_MS ?? 240_000)),
  });

  if (!response.ok) {
    throw new Error(`NemoHermes request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
      text?: string;
    }>;
  };
  const rawOutput = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text;
  if (!rawOutput) throw new Error("NemoHermes returned no text output.");

  return {
    backend: "nemohermes",
    rawOutput: rawOutput.trim(),
  };
}

function runLocalHermesTask(input: { prompt: string; cwd: string; skills?: string[]; timeoutMs?: number }): HermesRunnerResult {
  const skillArgs = input.skills?.length ? ["--skills", input.skills.join(",")] : [];
  const rawOutput = execFileSync("hermes", [...skillArgs, "-z", input.prompt], {
    cwd: input.cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: "pipe",
    timeout: input.timeoutMs ?? 240_000,
  }).trim();

  return {
    backend: "local",
    rawOutput,
  };
}
