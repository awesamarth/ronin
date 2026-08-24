import { describe, expect, test } from "bun:test";
import { buildPublicRoninPrompt, buildPublicRoninSystemPrompt } from "./public-ronin";

describe("public Ronin prompt", () => {
  test("is conversational without granting private access", () => {
    const system = buildPublicRoninSystemPrompt();
    const prompt = buildPublicRoninPrompt("What else can you do?", [{ role: "assistant", content: "Earlier answer" }]);

    expect(system).toContain("Continue the conversation naturally");
    expect(system).toContain("no company knowledge");
    expect(system).toContain("no company knowledge, repository access, tools, shell, or private information");
    expect(prompt).toContain("Earlier answer");
    expect(prompt).toContain("What else can you do?");
  });
});
