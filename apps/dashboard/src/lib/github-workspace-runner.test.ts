import { afterEach, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { recoverPushedWorkspace } from "./github-workspace-runner";

const originalFetch = globalThis.fetch;
const originalAppId = process.env.GITHUB_APP_ID;
const originalPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = originalAppId;
  if (originalPrivateKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
  else process.env.GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
});

test("a pushed branch is recovered when the agent final report times out", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const calls: Array<{ body?: unknown; url: string }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ body: init?.body && JSON.parse(String(init.body)), url: String(url) });
    if (String(url).includes("/access_tokens")) return Response.json({ token: "scoped", expires_at: "2099-01-01" });
    return Response.json({
      ahead_by: 1,
      commits: [{ sha: "abc1234" }],
      files: [{ filename: "README.md", patch: "+example" }],
    });
  }) as typeof fetch;

  const result = await recoverPushedWorkspace({
    branch: "ronin/patch-run-1",
    error: new Error("timed out"),
    installationId: "456",
    repositoryId: "789",
    input: { baseBranch: "main", prompt: "p", repo: "acme/widget", runId: "run-1" },
  });

  expect(calls[0].body).toEqual({ repository_ids: [789], permissions: { contents: "read" } });
  expect(calls[1].url).toEndWith("/repos/acme/widget/compare/main...ronin%2Fpatch-run-1");
  expect(result).toMatchObject({ branch: "ronin/patch-run-1", changedFiles: ["README.md"], commitSha: "abc1234", pushed: true });
  expect(result?.agentOutput).toContain("recoveredFromPushedBranch");
});
