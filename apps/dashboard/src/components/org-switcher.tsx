"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OrgSwitcher({ activeOrgId, orgs }: { activeOrgId?: string; orgs: Array<{ orgId: string; orgName: string }> }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  if (orgs.length < 2) return null;

  return (
    <select
      aria-label="Active organization"
      className="ronin-button"
      disabled={saving}
      value={activeOrgId ?? ""}
      onChange={async (event) => {
        setSaving(true);
        const response = await fetch("/api/org/active", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId: event.target.value }),
        });
        setSaving(false);
        if (response.ok) router.refresh();
      }}
    >
      {!activeOrgId ? <option value="">Select organization</option> : null}
      {orgs.map((org) => <option key={org.orgId} value={org.orgId}>{org.orgName}</option>)}
    </select>
  );
}
