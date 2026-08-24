"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrgProfileForm({ orgId, profile }: { orgId: string; profile: string | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const profile = String(new FormData(event.currentTarget).get("profile") ?? "");
    const response = await fetch("/api/org/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, profile }),
    });
    setSaving(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Profile update failed.");
      return;
    }
    router.refresh();
  }

  return (
    <form className="mt-5 grid gap-3" onSubmit={submit}>
      <label className="font-mono text-xs uppercase tracking-[0.18em] text-ronin-muted" htmlFor="org-profile">
        Ronin org profile
      </label>
      <textarea
        className="min-h-28 w-full border border-ronin-border bg-ronin-panel px-3 py-2.5 text-sm leading-6 outline-none focus:border-ronin-strong-border"
        defaultValue={profile ?? ""}
        id="org-profile"
        maxLength={8000}
        name="profile"
        placeholder="Products, users, terminology, support expectations, and other durable company context."
      />
      <button className="ronin-button ronin-button-primary w-fit" disabled={saving} type="submit">
        {saving ? "Saving..." : "Save profile"}
      </button>
      {error ? <p className="text-sm text-ronin-danger">{error}</p> : null}
    </form>
  );
}
