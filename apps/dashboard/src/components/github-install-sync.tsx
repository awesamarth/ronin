"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function GitHubInstallSync({ installationId }: { installationId: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!installationId) return;

    let cancelled = false;

    async function syncInstallation() {
      setStatus("syncing");
      setMessage("Syncing GitHub installation...");

      try {
        const response = await fetch("/api/github/installations/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ installationId }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "GitHub installation sync failed.");
        }

        if (cancelled) return;
        setStatus("done");
        setMessage("GitHub App connected. Watching installed repositories.");
        router.replace("/");
        router.refresh();
      } catch (error) {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "GitHub installation sync failed.");
      }
    }

    void syncInstallation();

    return () => {
      cancelled = true;
    };
  }, [installationId, router]);

  if (!installationId || status === "idle") return null;

  return (
    <div className="border-b border-ronin-border bg-ronin-panel-muted px-5 py-3 font-mono text-xs uppercase tracking-[0.18em] text-ronin-muted md:px-8">
      {message}
    </div>
  );
}
