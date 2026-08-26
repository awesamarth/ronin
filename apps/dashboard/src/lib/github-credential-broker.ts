import { createHash } from "node:crypto";
import { createInstallationToken } from "./github-app";

const SYNC_WAIT_MS = 35_000;

export async function prepareGithubRepoCredential(input: {
  installationId: string;
  principalId: string;
  repo: string;
  repositoryId: string;
  runId: string;
  sandboxReady: boolean;
}) {
  const apiUrl = process.env.IRON_CONTROL_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.IRON_CONTROL_API_KEY?.trim();
  if (!apiUrl || !apiKey) throw new Error("IRON_CONTROL_API_URL and IRON_CONTROL_API_KEY are required for GitHub workspace access.");
  if (!/^prn_[A-Za-z0-9]+$/.test(input.principalId)) throw new Error("Centaur session did not return a valid credential principal.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo)) throw new Error(`Invalid GitHub repository: ${input.repo}`);
  const repositoryId = Number(input.repositoryId);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) throw new Error(`Repository ${input.repo} has no valid GitHub repository id.`);

  const { token } = await createInstallationToken(input.installationId, {
    repositoryIds: [repositoryId],
    permissions: { contents: "write" },
  });
  const foreignId = `ronin-gh-${createHash("sha256").update(`${input.runId}\0${input.repo}`).digest("hex").slice(0, 40)}`;
  const encodedCredential = Buffer.from(`x-access-token:${token}`).toString("base64");
  let secretId: string | undefined;

  try {
    const secret = await ironRequest<{ id: string }>({
      apiKey,
      apiUrl,
      body: {
        data: {
          foreign_id: foreignId,
          name: `Ronin temporary credential for ${input.repo}`,
          description: "Exact-repository GitHub App credential; replaced per workspace run.",
          kind: "custom",
          labels: { purpose: "ronin-github-workspace", repo: input.repo, run_id: input.runId },
          inject_config: { header: "Authorization", formatter: "Basic {{ .Value }}" },
          source: { source_type: "control_plane", secret: encodedCredential, config: {} },
          rules: [{ host: "github.com", http_methods: ["GET", "POST"], paths: [`/${input.repo}.git/*`] }],
        },
      },
      method: "PUT",
      path: `/api/v1/static_secrets/${foreignId}`,
    });
    secretId = secret.id;
    await ironRequest({
      apiKey,
      apiUrl,
      body: { data: { principal_id: input.principalId, static_secret_id: secret.id } },
      method: "POST",
      path: "/api/v1/grants",
    });
    if (input.sandboxReady) await waitForProxySync();
  } catch (error) {
    if (secretId) await deleteSecret({ apiKey, apiUrl, secretId }).catch(() => {});
    throw error;
  }

  return async () => {
    await deleteSecret({ apiKey, apiUrl, secretId: secretId! });
    if (input.sandboxReady) await waitForProxySync();
  };
}

function waitForProxySync() {
  return new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_MS));
}

async function deleteSecret(input: { apiKey: string; apiUrl: string; secretId: string }) {
  await ironRequest({ ...input, method: "DELETE", path: `/api/v1/static_secrets/${input.secretId}`, tolerateNotFound: true });
}

async function ironRequest<T = unknown>(input: {
  apiKey: string;
  apiUrl: string;
  body?: unknown;
  method: "DELETE" | "POST" | "PUT";
  path: string;
  secretId?: string;
  tolerateNotFound?: boolean;
}): Promise<T> {
  const response = await fetch(`${input.apiUrl}${input.path}`, {
    method: input.method,
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
      ...(process.env.IRON_CONTROL_HOST ? { host: process.env.IRON_CONTROL_HOST } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (input.tolerateNotFound && response.status === 404) return undefined as T;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Centaur credential broker ${input.method} ${input.path} failed: ${response.status} ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as { data: T }).data;
}
