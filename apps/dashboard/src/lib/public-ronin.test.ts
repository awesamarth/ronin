import { describe, expect, test } from "bun:test";
import { answerPublicRoninMessage } from "./public-ronin";

describe("public Ronin replies", () => {
  test("answers product questions without implying private access", () => {
    expect(answerPublicRoninMessage("What do you do?")).toContain("agentic solutions engineer");
    expect(answerPublicRoninMessage("Can you access private company knowledge?")).toBe(
      "This DM is in public mode. I can explain Ronin, but I cannot access any company’s repositories, knowledge, conversations, or tools unless an operator explicitly connects and authorizes this conversation.",
    );
  });
});
