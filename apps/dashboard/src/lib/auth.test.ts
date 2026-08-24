import { afterEach, expect, test } from "bun:test";
import { allowedGithubLogin, signOAuthState, signOperatorSession, verifyOAuthState, verifyOperatorSession } from "./auth";

const previousSecret = process.env.RONIN_SESSION_SECRET;
const previousUsers = process.env.RONIN_ALLOWED_GITHUB_USERS;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.RONIN_SESSION_SECRET;
  else process.env.RONIN_SESSION_SECRET = previousSecret;
  if (previousUsers === undefined) delete process.env.RONIN_ALLOWED_GITHUB_USERS;
  else process.env.RONIN_ALLOWED_GITHUB_USERS = previousUsers;
});

test("operator sessions, OAuth state, and optional GitHub admission allowlist", async () => {
  process.env.RONIN_SESSION_SECRET = "test-secret-that-is-at-least-32-bytes-long";
  process.env.RONIN_ALLOWED_GITHUB_USERS = "Alice, bob";

  expect(allowedGithubLogin("ALICE")).toBe(true);
  expect(allowedGithubLogin("mallory")).toBe(false);
  delete process.env.RONIN_ALLOWED_GITHUB_USERS;
  expect(allowedGithubLogin("new-customer")).toBe(true);
  process.env.RONIN_ALLOWED_GITHUB_USERS = "Alice, bob";

  const session = await signOperatorSession({ id: "1", login: "alice" });
  expect(await verifyOperatorSession(session)).toEqual({ id: "1", login: "alice", name: undefined, avatarUrl: undefined, activeOrgId: undefined });
  expect(await verifyOperatorSession(`${session}x`)).toBeNull();
  expect(await verifyOperatorSession(await signOperatorSession({ id: "1", login: "alice" }, "-1s"))).toBeNull();

  const state = await signOAuthState("nonce", "installation-1");
  expect(await verifyOAuthState(state)).toEqual({ nonce: "nonce", pendingInstallationId: "installation-1" });
  expect(await verifyOAuthState(`${state}x`)).toBeNull();
});
