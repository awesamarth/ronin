"use client";

import type { ProvisioningStatus, SlackConnection, TelegramConnection } from "@/lib/dashboard-data";
import { useEffect, useState } from "react";
import { ProvisioningPanel } from "./provisioning-panel";
import { SlackChannelMappingForm } from "./slack-channel-mapping-form";
import { TelegramChatMappingForm } from "./telegram-chat-mapping-form";

export function ConfigureActions({
  provisioning,
  slack,
  telegram,
}: {
  provisioning: ProvisioningStatus | null;
  slack: SlackConnection;
  telegram: TelegramConnection;
}) {
  const [activePanel, setActivePanel] = useState<"slack" | "telegram" | "spend" | null>(null);
  const panelTitle = activePanel === "slack" ? "Slack" : activePanel === "telegram" ? "Telegram" : "Spend";

  useEffect(() => {
    if (!activePanel) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActivePanel(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [activePanel]);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button className="ronin-button" onClick={() => setActivePanel("slack")} type="button">
          Slack
        </button>
        <button className="ronin-button" onClick={() => setActivePanel("telegram")} type="button">
          Telegram
        </button>
        <button className="ronin-button" onClick={() => setActivePanel("spend")} type="button">
          Spend
        </button>
      </div>

      {activePanel ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={() => setActivePanel(null)}>
          <div className="max-h-[calc(100vh-2rem)] w-[min(48rem,100%)] overflow-y-auto border border-ronin-border bg-ronin-background text-ronin-foreground" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ronin-border bg-ronin-panel px-4 py-3">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-ronin-muted">{panelTitle}</p>
              <button className="ronin-button" onClick={() => setActivePanel(null)} type="button">
                Close
              </button>
            </div>
            <div className="p-4 md:p-5">
              {activePanel === "slack" ? <SlackChannelMappingForm slack={slack} /> : null}
              {activePanel === "telegram" ? <TelegramChatMappingForm telegram={telegram} /> : null}
              {activePanel === "spend" ? <ProvisioningPanel provisioning={provisioning} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
