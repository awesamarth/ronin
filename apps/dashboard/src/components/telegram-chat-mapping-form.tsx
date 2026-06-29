"use client";

import type { TelegramConnection } from "@/lib/dashboard-data";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TelegramChatMappingForm({ telegram }: { telegram: TelegramConnection }) {
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

    const response = await fetch("/api/telegram/chats", {
      body: JSON.stringify({
        botUsername: telegram.botUsername,
        chatId: formData.get("chatId"),
        displayName: formData.get("displayName"),
        repoId: formData.get("repoId"),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    setIsSaving(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Telegram chat mapping failed.");
      return;
    }

    form.reset();
    router.refresh();
  }

  async function deleteRoute(id: string) {
    setDeletingId(id);
    setError(null);

    const response = await fetch("/api/telegram/chats", {
      body: JSON.stringify({ id }),
      headers: {
        "content-type": "application/json",
      },
      method: "DELETE",
    });

    setDeletingId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Telegram route deletion failed.");
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
            <h3 className="mt-2 text-lg font-semibold">Telegram chats</h3>
            <p className="mt-2 text-sm leading-6 text-ronin-muted">
              Route a Telegram chat or topic to a watched repo so Ronin can answer with the right org and codebase context.
            </p>
          </div>
          <StatusBadge label={telegram.configured ? "Connected" : "Needs token"} tone={telegram.configured ? "success" : "warning"} />
        </div>
        <div className="mt-4 grid border border-ronin-border bg-ronin-background">
          <FactLine label="Bot" value={telegram.botUsername ? `@${telegram.botUsername}` : "Not detected"} />
          <FactLine label="Mode" value="Long polling" />
          <FactLine label="Repos" value={telegram.repos.length ? `${telegram.repos.length} watched` : "Connect GitHub first"} />
        </div>
      </div>

      <form className="grid gap-3 border border-ronin-border bg-ronin-panel p-4" onSubmit={submit}>
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ronin-muted">Add route</p>
          <p className="mt-2 text-sm leading-6 text-ronin-muted">
            Use a chat ID, or chat ID plus topic ID, when a support topic should always resolve to one repo.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="telegram-chat-id">
              Telegram chat ID
            </label>
            <input
              className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition placeholder:text-ronin-muted focus:border-ronin-strong-border"
              id="telegram-chat-id"
              name="chatId"
              placeholder="-100..., 123..., or -100...:topic"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="telegram-display-name">
              Display name
            </label>
            <input
              className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition placeholder:text-ronin-muted focus:border-ronin-strong-border"
              id="telegram-display-name"
              name="displayName"
              placeholder="builders group or support topic"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium uppercase tracking-[0.2em] text-ronin-muted" htmlFor="telegram-repo-id">
            Default repo
          </label>
          <select
            className="mt-2 w-full border border-ronin-border bg-ronin-background px-3 py-2.5 font-mono text-sm text-ronin-foreground outline-none transition focus:border-ronin-strong-border"
            id="telegram-repo-id"
            name="repoId"
            required
          >
            {telegram.repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.fullName}
              </option>
            ))}
          </select>
        </div>

        <button
          className="ronin-button ronin-button-primary w-fit disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isSaving || !telegram.configured || !telegram.repos.length}
          type="submit"
        >
          {isSaving ? "Saving..." : "Route Telegram chat"}
        </button>
        {error ? <p className="text-sm leading-6 text-ronin-danger">{error}</p> : null}
        {!telegram.configured ? <p className="text-sm leading-6 text-ronin-warning">Telegram token is missing, so routing is disabled.</p> : null}
        {telegram.configured && !telegram.repos.length ? <p className="text-sm leading-6 text-ronin-warning">Connect GitHub before mapping support chats.</p> : null}
      </form>

      <div className="grid border border-ronin-border bg-ronin-panel">
        <div className="border-b border-ronin-border p-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ronin-muted">Active routes</p>
        </div>
        {telegram.chats.length ? (
          telegram.chats.map((chat) => (
            <div className="grid gap-3 border-b border-ronin-border p-4 last:border-b-0 md:grid-cols-[1fr_1fr_auto] md:items-center" key={chat.id}>
              <div>
                <p className="font-medium">{chat.displayName}</p>
                <p className="mt-1 font-mono text-xs text-ronin-muted">{chat.platformChannelId}</p>
              </div>
              <p className="font-mono text-sm text-ronin-muted md:text-right">{chat.repo ?? "No repo mapped"}</p>
              <button className="ronin-button w-fit" disabled={deletingId === chat.id} onClick={() => deleteRoute(chat.id)} type="button">
                {deletingId === chat.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))
        ) : (
          <div className="p-4 text-sm leading-6 text-ronin-muted">
            No Telegram routes yet. Add a chat after the GitHub App is connected and the Telegram bot is configured.
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
