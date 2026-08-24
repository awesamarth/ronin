"use client";

import type { OrgMember } from "@/lib/dashboard-data";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrgMembers({ canManage, members }: { canManage: boolean; members: OrgMember[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(userId: string, patch: { role?: string; status?: string }) {
    setSaving(userId);
    setError(null);
    const response = await fetch("/api/org/members", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, ...patch }),
    });
    setSaving(null);
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Membership update failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-5 border border-ronin-border bg-ronin-panel">
      <div className="border-b border-ronin-border p-4">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ronin-muted">Organization access</p>
      </div>
      {members.map((member) => (
        <div className="grid gap-3 border-b border-ronin-border p-4 last:border-b-0 md:grid-cols-[1fr_auto_auto] md:items-center" key={member.userId}>
          <div>
            <p className="font-medium">{member.displayName}</p>
            <p className="mt-1 font-mono text-xs text-ronin-muted">{member.identity}</p>
          </div>
          <select
            aria-label={`Role for ${member.displayName}`}
            className="ronin-button"
            disabled={!canManage || saving === member.userId}
            value={member.role}
            onChange={(event) => update(member.userId, { role: event.target.value })}
          >
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="external">External</option>
          </select>
          <button
            className="ronin-button"
            disabled={!canManage || saving === member.userId}
            onClick={() => update(member.userId, { status: member.status === "active" ? "suspended" : "active" })}
            type="button"
          >
            {member.status === "active" ? "Suspend" : "Activate"}
          </button>
        </div>
      ))}
      {!members.length ? <p className="p-4 text-sm text-ronin-muted">No members yet.</p> : null}
      {error ? <p className="border-t border-ronin-border p-4 text-sm text-ronin-danger">{error}</p> : null}
    </div>
  );
}
