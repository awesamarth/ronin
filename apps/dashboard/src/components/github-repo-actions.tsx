"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function GitHubRepoActions({
  connected,
  installUrl,
}: {
  connected: boolean;
  installUrl: string;
}) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function syncRepos() {
    setIsSyncing(true);
    setMessage("Syncing GitHub installation...");

    try {
      const response = await fetch("/api/github/installations/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        backgroundProcessing?: boolean;
        error?: string;
        onboardingRunIds?: string[];
        repositories?: string[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "GitHub sync failed.");
      }

      const newRuns = payload.onboardingRunIds?.length ?? 0;
      setMessage(
        newRuns
          ? payload.backgroundProcessing
            ? `Synced ${payload.repositories?.length ?? 0} repos and queued ${newRuns} onboarding run${newRuns === 1 ? "" : "s"} in the background.`
            : `Synced ${payload.repositories?.length ?? 0} repos and queued ${newRuns} onboarding run${newRuns === 1 ? "" : "s"}.`
          : `Synced ${payload.repositories?.length ?? 0} repos. No new repos to onboard.`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "GitHub sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <a className="ronin-button ronin-button-primary gap-1.5" href={installUrl} rel="noreferrer" target="_blank">
          {connected ? "Manage repos" : "Connect GitHub"}
          <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
        </a>
        {connected ? (
          <button className="ronin-button gap-1.5" disabled={isSyncing} onClick={syncRepos} type="button">
            <RefreshCw aria-hidden="true" className={isSyncing ? "animate-spin" : ""} size={14} strokeWidth={1.8} />
            {isSyncing ? "Syncing" : "Sync repos"}
          </button>
        ) : null}
      </div>
      {message ? <p className="text-sm leading-6 text-ronin-muted">{message}</p> : null}
    </div>
  );
}
