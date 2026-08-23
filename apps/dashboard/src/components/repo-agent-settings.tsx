"use client";

import { useState } from "react";

const inputClass = "border border-ronin-border bg-ronin-background px-3 py-2 font-mono text-sm text-ronin-foreground outline-none focus:border-ronin-strong-border";

export function RepoAgentSettings({ repo }: { repo: { id: string; harnessType: string; model: string | null; provider: string | null; reasoning: string | null } }) {
  const [status, setStatus] = useState("");

  return (
    <details className="mt-4 border-t border-ronin-border pt-3">
      <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.18em] text-ronin-muted">Agent settings</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setStatus("Saving…");
          const values = Object.fromEntries(new FormData(event.currentTarget));
          const response = await fetch(`/api/github/repos/${repo.id}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(values),
          });
          setStatus(response.ok ? "Saved" : "Could not save");
        }}
      >
        <label className="grid gap-1 font-mono text-xs text-ronin-muted">
          Harness
          <select className={inputClass} defaultValue={repo.harnessType} name="harnessType">
            {['pi', 'codex', 'claudecode', 'amp', 'nanocodex', 'hermes'].map((harness) => <option key={harness}>{harness}</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-mono text-xs text-ronin-muted">
          Reasoning
          <select className={inputClass} defaultValue={repo.reasoning ?? ""} name="reasoning">
            {['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((level) => <option key={level} value={level}>{level || 'Harness default'}</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-mono text-xs text-ronin-muted">
          Provider
          <input className={inputClass} defaultValue={repo.provider ?? ""} name="provider" placeholder="Harness default" />
        </label>
        <label className="grid gap-1 font-mono text-xs text-ronin-muted">
          Model
          <input className={inputClass} defaultValue={repo.model ?? ""} name="model" placeholder="Harness default" />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="ronin-button ronin-button-primary" type="submit">Save</button>
          <span aria-live="polite" className="font-mono text-xs text-ronin-muted">{status}</span>
        </div>
      </form>
    </details>
  );
}
