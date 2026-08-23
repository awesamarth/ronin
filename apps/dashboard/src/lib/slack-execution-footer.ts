import type { CentaurResult } from "./centaur-client";

type ExecutionConfig = CentaurResult["config"] | undefined;

export function withSlackExecutionFooter(reply: string, config: ExecutionConfig) {
  if (!config) return reply;

  const parts = [displayHarness(config.harness), config.model && displayModel(config.model), config.reasoning && title(config.reasoning)].filter(Boolean);
  return parts.length > 1 ? `${reply}\n\n_${parts.join(" · ")}_` : reply;
}

function displayHarness(harness: string) {
  return ({ claudecode: "Claude", codex: "Codex", nanocodex: "Nanocodex", pi: "Pi" } as Record<string, string>)[harness] ?? title(harness);
}

function displayModel(model: string) {
  return title(model.replace(/^gpt-/i, "GPT-").replace(/-([a-z])/g, (_, letter: string) => ` ${letter.toUpperCase()}`));
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
