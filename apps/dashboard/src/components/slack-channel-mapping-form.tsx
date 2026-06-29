"use client";

import type { SlackConnection } from "@/lib/dashboard-data";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SlackChannelMappingForm({ slack }: { slack: SlackConnection }) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsSaving(true);
    setError(null);

    const response = await fetch("/api/slack/channels", {
      body: JSON.stringify({
        channelId: formData.get("channelId"),
        displayName: formData.get("displayName"),
        repoId: formData.get("repoId"),
        teamId: slack.teamId,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    setIsSaving(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Slack channel mapping failed.");
      return;
    }

    form.reset();
    router.refresh();
  }

  async function deleteRoute(id: string) {
    setDeletingId(id);
    setError(null);

    const response = await fetch("/api/slack/channels", {
      body: JSON.stringify({ id }),
      headers: {
        "content-type": "application/json",
      },
      method: "DELETE",
    });

    setDeletingId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Slack route deletion failed.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <div className="border border-ronin-border bg-ronin-panel p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-ronin-muted">Support routing</p>
            <h3 className="mt-2 text-lg font-semibold">Slack channels</h3>
            <p className="mt-2 text-sm leading-6 text-ronin-muted">
              Route a Slack channel or DM to a watched repo so Ronin can answer with the right org and codebase context.
            </p>
          </div>
          <StatusBadge label={slack.configured ? "Connected" : "Needs env"} tone={slack.configured ? "success" : "warning"} />
        </div>
        <div className="mt-4 grid border border-ronin-border bg-ronin-background">
          <FactLine label="Workspace" value={slack.teamId || "Not configured"} />
          <FactLine label="Bot" value={slack.botUserId ?? "Not detected"} />
          <FactLine label="Repos" value={slack.repos.length ? `${slack.repos.length} watched` : "Connect GitHub first"} />
        </div>
      </div>

      <form className="grid gap-3 border border-ronin-border bg-ronin-panel p-4" onSubmit={submit}>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ronin-muted">Add route</p>
          <p className="mt-2 text-sm leading-6 text-ronin-muted">
            Use this when a customer support channel should always resolve to one repo.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="slack-channel-id">
              Slack channel ID
            </label>
            <input
              className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition placeholder:text-ronin-muted focus:border-ronin-strong-border"
              id="slack-channel-id"
              name="channelId"
              placeholder="C123..., D123..."
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="slack-display-name">
              Display name
            </label>
            <input
              className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition placeholder:text-ronin-muted focus:border-ronin-strong-border"
              id="slack-display-name"
              name="displayName"
              placeholder="#support or Ronin DM"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="slack-repo-id">
            Default repo
          </label>
          <select
            className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition focus:border-ronin-strong-border"
            id="slack-repo-id"
            name="repoId"
            required
          >
            {slack.repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.fullName}
              </option>
            ))}
          </select>
        </div>

        <button
          className="ronin-button ronin-button-primary w-fit disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSaving || !slack.configured || !slack.repos.length}
          type="submit"
        >
          {isSaving ? "Saving..." : "Route Slack channel"}
        </button>
        {error ? <p className="text-sm leading-6 text-ronin-danger">{error}</p> : null}
        {!slack.configured ? <p className="text-sm leading-6 text-ronin-warning">Slack env is missing, so routing is disabled.</p> : null}
        {slack.configured && !slack.repos.length ? <p className="text-sm leading-6 text-ronin-warning">Connect GitHub before mapping support channels.</p> : null}
      </form>

      <div className="grid border border-ronin-border bg-ronin-panel">
        <div className="border-b border-ronin-border p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ronin-muted">Active routes</p>
        </div>
        {slack.channels.length ? (
          slack.channels.map((channel) => (
            <div className="grid gap-3 border-b border-ronin-border p-4 last:border-b-0 md:grid-cols-[1fr_1fr_auto] md:items-center" key={channel.id}>
              <div>
                <p className="font-medium">{channel.displayName}</p>
                <p className="mt-1 font-mono text-xs text-ronin-muted">{channel.platformChannelId}</p>
              </div>
              <p className="font-mono text-sm text-ronin-muted md:text-right">{channel.repo ?? "No repo mapped"}</p>
              <button className="ronin-button w-fit" disabled={deletingId === channel.id} onClick={() => deleteRoute(channel.id)} type="button">
                {deletingId === channel.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))
        ) : (
          <div className="p-4 text-sm leading-6 text-ronin-muted">
            No Slack routes yet. Add a channel after the GitHub App is connected and the Slack connector is configured.
          </div>
        )}
      </div>
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

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" }) {
  const toneClass = tone === "success" ? "border-ronin-success text-ronin-success" : "border-ronin-warning text-ronin-warning";

  return (
    <span className={`inline-flex w-fit whitespace-nowrap border bg-ronin-panel-muted px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClass}`}>
      {label}
    </span>
  );
}
