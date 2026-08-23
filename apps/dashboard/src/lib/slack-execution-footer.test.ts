import { describe, expect, test } from "bun:test";
import { withSlackExecutionFooter } from "./slack-execution-footer";

describe("Slack execution footer", () => {
  test("shows the effective harness, model, and reasoning without exposing Centaur", () => {
    const reply = withSlackExecutionFooter("Hello.", {
      harness: "pi",
      model: "gpt-5.6-luna",
      provider: "openai-codex",
      reasoning: "medium",
    });

    expect(reply).toBe("Hello.\n\n_Pi · GPT-5.6 Luna · Medium_");
    expect(reply).not.toContain("Centaur");
  });
});
