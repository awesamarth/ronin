export type RunStepStatus = "queued" | "running" | "done" | "blocked";

const labels: Record<RunStepStatus, string> = {
  blocked: "Blocked",
  done: "Done",
  queued: "Queued",
  running: "Running",
};

const classes: Record<RunStepStatus, string> = {
  blocked: "border-ronin-danger text-ronin-danger",
  done: "border-ronin-success text-ronin-success",
  queued: "border-ronin-border text-ronin-muted",
  running: "border-ronin-warning text-ronin-warning",
};

export function StatusPill({ status }: { status: RunStepStatus }) {
  return (
    <span className={`inline-flex w-fit shrink-0 self-start whitespace-nowrap border bg-ronin-panel-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${classes[status]}`}>
      {labels[status]}
    </span>
  );
}
