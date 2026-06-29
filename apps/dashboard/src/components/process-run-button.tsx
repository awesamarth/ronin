"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProcessRunButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function processRun() {
    setIsProcessing(true);
    setError(null);

    const response = await fetch("/api/runs/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    setIsProcessing(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Run processing failed.");
      router.refresh();
      return;
    }

    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <button className="ronin-button ronin-button-primary w-fit" disabled={disabled || isProcessing} onClick={processRun} type="button">
        {isProcessing ? "Processing..." : "Process queued run"}
      </button>
      {error ? <p className="text-sm leading-6 text-ronin-danger">{error}</p> : null}
    </div>
  );
}
