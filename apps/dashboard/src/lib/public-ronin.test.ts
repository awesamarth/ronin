import { describe, expect, test } from "bun:test";
import { buildPublicRoninPrompt } from "./public-ronin";

describe("public Ronin prompt", () => {
  test("is conversational without granting private access", () => {
    const prompt = buildPublicRoninPrompt("What else can you do?");

    expect(prompt).toContain("Continue the conversation naturally");
    expect(prompt).toContain("no company knowledge or repository access");
    expect(prompt).toContain("What else can you do?");
  });
});
