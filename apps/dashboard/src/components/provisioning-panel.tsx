"use client";

import type { ProvisioningStatus } from "@/lib/dashboard-data";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProvisioningPanel({ provisioning }: { provisioning: ProvisioningStatus | null }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    setIsCreating(true);
    setError(null);

    const response = await fetch("/api/provisioning/plan", {
      body: JSON.stringify({
        budgetDollars: Number(formData.get("budgetDollars") ?? 5),
        provider: formData.get("provider"),
        purpose: formData.get("purpose"),
        resource: formData.get("resource"),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    setIsCreating(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Provisioning plan failed.");
      return;
    }

    router.refresh();
  }

  async function approvePlan() {
    setIsApproving(true);
    setError(null);

    const response = await fetch("/api/provisioning/approve", {
      method: "POST",
    });

    setIsApproving(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Provisioning approval failed.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <div className="grid border border-ronin-border bg-ronin-panel">
        <FactLine label="Status" value={provisioning?.status ?? "No plan"} />
        <FactLine label="Provider" value={providerLabel(provisioning?.input.provider)} />
        <FactLine label="Budget" value={formatBudget(provisioning?.input.budgetCents)} />
      </div>

      <form className="grid gap-3 border border-ronin-border bg-ronin-panel p-4" onSubmit={createPlan}>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="provisioning-provider">
              Provider
            </label>
            <select
              className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition focus:border-ronin-strong-border"
              defaultValue="vercel"
              id="provisioning-provider"
              name="provider"
            >
              <option value="vercel">Vercel</option>
              <option value="neon">Neon</option>
              <option value="upstash">Upstash</option>
              <option value="generic">Generic</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="provisioning-budget">
              Budget cap USD
            </label>
            <input
              className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition placeholder:text-ronin-muted focus:border-ronin-strong-border"
              defaultValue="5"
              id="provisioning-budget"
              min="1"
              name="budgetDollars"
              step="1"
              type="number"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="provisioning-resource">
            Resource
          </label>
          <input
            className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition placeholder:text-ronin-muted focus:border-ronin-strong-border"
            defaultValue="Ronin generated docs deployment"
            id="provisioning-resource"
            name="resource"
          />
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="provisioning-purpose">
            Purpose
          </label>
          <textarea
            className="mt-2 min-h-24 w-full resize-y border border-ronin-border bg-ronin-background px-3 py-2.5 text-sm leading-6 text-ronin-foreground outline-none transition placeholder:text-ronin-muted focus:border-ronin-strong-border"
            defaultValue="Deploy Ronin generated docs or demo infrastructure for a protocol integration run."
            id="provisioning-purpose"
            name="purpose"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="ronin-button ronin-button-primary" disabled={isCreating} type="submit">
            {isCreating ? "Creating plan..." : "Create spend plan"}
          </button>
          <button
            className="ronin-button"
            disabled={isApproving || provisioning?.status !== "approval_required"}
            onClick={approvePlan}
            type="button"
          >
            {isApproving ? "Recording approval..." : "Approve latest plan"}
          </button>
        </div>
        {error ? <p className="text-sm leading-6 text-ronin-danger">{error}</p> : null}
      </form>

      {provisioning ? (
        <div className="grid gap-3 border border-ronin-border bg-ronin-panel p-4">
          <p className="text-sm leading-6 text-ronin-muted">{provisioning.summary}</p>
          {provisioning.artifacts.map((artifact) => (
            <div className="border border-ronin-border bg-ronin-panel-muted p-3" key={`${artifact.kind}-${artifact.title}`}>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-ronin-muted">{artifact.title}</p>
              <p className="mt-2 line-clamp-5 whitespace-pre-line text-sm leading-6 text-ronin-muted">{artifact.content}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FactLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 border-b border-ronin-border px-4 py-3 last:border-b-0 sm:grid-cols-[8rem_1fr]">
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-ronin-muted">{label}</span>
      <span className="break-words font-mono text-sm">{value}</span>
    </div>
  );
}

function providerLabel(provider?: string) {
  if (provider === "vercel") return "Vercel";
  if (provider === "neon") return "Neon";
  if (provider === "upstash") return "Upstash";
  if (provider === "generic") return "Generic";
  return "Not selected";
}

function formatBudget(cents?: number) {
  if (typeof cents !== "number") return "No cap";
  return `$${(cents / 100).toFixed(2)}`;
}
