"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OpenGitHubPrButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  async function openPr() {
    setIsOpening(true);
    setError(null);
    setPrUrl(null);

    const response = await fetch("/api/github/prs", {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; prUrl?: string } | null;

    setIsOpening(false);

    if (!response.ok) {
      setError(payload?.error ?? "Failed to open GitHub PR.");
      router.refresh();
      return;
    }

    setPrUrl(payload?.prUrl ?? null);
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <button className="ronin-button w-fit" disabled={disabled || isOpening} onClick={openPr} type="button">
        {isOpening ? "Opening PR..." : "Open PR from run"}
      </button>
      {prUrl ? (
        <a className="text-sm font-semibold text-ronin-success underline underline-offset-4" href={prUrl}>
          View GitHub PR
        </a>
      ) : null}
      {error ? <p className="text-sm leading-6 text-ronin-danger">{error}</p> : null}
    </div>
  );
}
