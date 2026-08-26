import { afterEach, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { prepareGithubRepoCredential } from "./github-credential-broker";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test("workspace credentials are exact-repo, principal-bound, and deleted", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  process.env.IRON_CONTROL_API_URL = "http://iron.test";
  process.env.IRON_CONTROL_API_KEY = "control-key";

  const calls: Array<{ body?: Record<string, unknown>; method: string; url: string }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ body, method: init?.method ?? "GET", url: String(url) });
    if (String(url).includes("api.github.com/app/installations")) {
      return Response.json({ token: "github-secret", expires_at: "2099-01-01T00:00:00Z" });
    }
    if (init?.method === "PUT") return Response.json({ data: { id: "ssr_scoped" } }, { status: 201 });
    if (init?.method === "POST") return Response.json({ data: { id: "grant_scoped" } }, { status: 201 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const cleanup = await prepareGithubRepoCredential({
    installationId: "456",
    principalId: "prn_abc123",
    repo: "acme/widget",
    repositoryId: "789",
    runId: "run-1",
    sandboxReady: false,
  });
  await cleanup();

  expect(calls[0].body).toEqual({ repository_ids: [789], permissions: { contents: "write" } });
  const secret = calls[1].body!.data as Record<string, unknown>;
  expect(secret.rules).toEqual([{ host: "github.com", http_methods: ["GET", "POST"], paths: ["/acme/widget.git/*"] }]);
  expect(secret.inject_config).toEqual({ header: "Authorization", formatter: "Basic {{ .Value }}" });
  expect(JSON.stringify(secret)).not.toContain("github-secret");
  expect(calls[2].body).toEqual({ data: { principal_id: "prn_abc123", static_secret_id: "ssr_scoped" } });
  expect(calls[3].method).toBe("DELETE");
  expect(calls[3].url).toBe("http://iron.test/api/v1/static_secrets/ssr_scoped");
});
