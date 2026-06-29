import { ConfigureActions } from "@/components/configure-actions";
import { GitHubInstallSync } from "@/components/github-install-sync";
import { GitHubRepoActions } from "@/components/github-repo-actions";
import { StatusPill } from "@/components/status-pill";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  type DashboardRun,
  getActivityFeed,
  getLatestDashboardRun,
  getLatestProvisioningStatus,
  getSlackConnection,
  getTelegramConnection,
  getWorkspaceOverview,
} from "@/lib/dashboard-data";
import type { ActivityEvent } from "@/lib/dashboard-data";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const installationId = getSingleSearchParam(resolvedSearchParams?.installation_id);
  const [workspace, dbRun, activity, provisioning, slack, telegram] = await Promise.all([
    getWorkspaceOverview(),
    getLatestDashboardRun(),
    getActivityFeed(),
    getLatestProvisioningStatus(),
    getSlackConnection(),
    getTelegramConnection(),
  ]);
  const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL || "http://localhost:3005/docs";
  const githubInstallUrl = process.env.GITHUB_APP_INSTALL_URL || "https://github.com/apps/ronin-agent/installations/new";
  const latestPrUrl = dbRun?.artifacts.find((artifact) => artifact.kind === "github_pull_request")?.content;
  const visibleArtifacts = dedupeArtifacts(dbRun?.artifacts.filter((artifact) => artifact.kind !== "github_pull_request") ?? []).slice(0, 3);

  return (
    <main className="min-h-screen px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto max-w-7xl border border-ronin-border bg-ronin-background/92">
        <header className="border-b border-ronin-border p-6 md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="font-ronin-display text-6xl leading-none md:text-8xl -ml-1">Ronin</h1>
              <p className="mt-2.5 max-w-4xl text-lg leading-8 text-ronin-muted md:text-xl md:leading-9">
                Agentic solutions engineering for protocol teams. Connect your org, install the GitHub App, map support
                channels, then let Hermes maintain docs, reviews, answers, and integration work through Ronin.
              </p>
            </div>
            <nav className="flex shrink-0 items-center gap-2">
              <Link className="ronin-button gap-1.5" href={docsUrl} rel="noreferrer" target="_blank">
                Docs
                <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
              </Link>
              <a className="ronin-button ronin-button-primary" href="#watch">
                Start
              </a>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <GitHubInstallSync installationId={installationId} />

        <section className="grid border-b border-ronin-border lg:grid-cols-[2fr_3fr]">
          <div className="border-b border-ronin-border p-5 md:p-8 lg:border-b-0 lg:border-r">
            <SectionLabel>Onboarding</SectionLabel>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-5xl">Connect your GitHub.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-ronin-muted">
              Ronin owns tenant routing, permissions, artifacts, and audit logs. Hermes runs after Ronin has resolved the
              org, channel, repo scope, and allowed action.
            </p>
          </div>
          <div className="grid md:grid-cols-2">
            {onboardingSteps.map((step) => (
              <div className="border-b border-ronin-border p-5 last:border-b-0 md:border-r md:last:border-r-0 md:[&:nth-child(2n)]:border-r-0 md:[&:nth-last-child(-n+2)]:border-b-0" key={step.title}>
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-ronin-muted">{step.label}</p>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-ronin-muted">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="watch" className="grid border-b border-ronin-border lg:grid-cols-[2fr_3fr]">
          <div className="border-b border-ronin-border p-5 md:p-8 lg:border-b-0 lg:border-r">
            <SectionLabel>Watch repo via Ronin</SectionLabel>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Watched repositories.</h2>
            <p className="mt-3 text-sm leading-6 text-ronin-muted">
              Repos installed through the GitHub App are watched for pushes and PRs. New events become Ronin runs
              automatically.
            </p>

            <div className="mt-6 grid border border-ronin-border bg-ronin-panel">
              <FactRow label="Org" value={workspace?.orgName ?? "No org connected"} />
              <FactRow label="GitHub App" value={workspace?.githubConnected ? "Connected" : "Not connected"} />
              <FactRow label="Repos" value={workspace ? String(workspace.repos.length) : "0"} />
            </div>
            <GitHubRepoActions connected={Boolean(workspace?.githubConnected)} installUrl={githubInstallUrl} />

            <div className="mt-5 grid gap-3">
              {workspace?.repos.length ? (
                workspace.repos.map((repo) => <RepoCard key={repo.id} repo={repo} />)
              ) : (
                <div className="border border-ronin-border bg-ronin-panel p-4 text-sm leading-6 text-ronin-muted">
                  Install the GitHub App to start watching repositories.
                </div>
              )}
            </div>
          </div>

          <div className="p-5 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <SectionLabel>Latest agent work</SectionLabel>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight">{dbRun ? dbRun.repo : "No GitHub run yet"}</h2>
              </div>
              <StatusPill status={dbRun ? statusForRun(dbRun.status) : "queued"} />
            </div>

            <p className="mt-4 text-sm leading-6 text-ronin-muted">
              {dbRun ? dbRun.summary : "When a watched repo receives a push or PR event, Ronin will analyze it here."}
            </p>

            {dbRun ? (
              <div className="mt-5 grid border border-ronin-border bg-ronin-panel">
                <FactRow label="Run" value={dbRun.id} />
                <FactRow label="Kind" value={dbRun.kind} />
                <FactRow label="Source" value={runSource(dbRun)} />
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {latestPrUrl ? (
                <a className="ronin-button ronin-button-primary gap-1.5" href={latestPrUrl} rel="noreferrer" target="_blank">
                  Open PR
                  <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
                </a>
              ) : null}
              <Link className="ronin-link-button" href={`${docsUrl}/generated/quickstart`} rel="noreferrer" target="_blank">
                Quickstart
                <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
              </Link>
              <Link className="ronin-link-button" href={`${docsUrl}/generated/integration-report`} rel="noreferrer" target="_blank">
                Report
                <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
              </Link>
              <Link className="ronin-link-button" href={`${docsUrl}/generated/known-issues`} rel="noreferrer" target="_blank">
                Known issues
                <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
              </Link>
            </div>

            {visibleArtifacts.length ? (
              <div className="mt-5 grid gap-3">
                {visibleArtifacts.map((artifact) => (
                  <div className="border border-ronin-border bg-ronin-panel-muted p-3" key={`${artifact.kind}-${artifact.title}-${artifact.createdAt}`}>
                    <p className="font-mono text-xs uppercase tracking-[0.18em] text-ronin-muted">{artifact.title}</p>
                    <p className="mt-2 line-clamp-4 text-sm leading-6 text-ronin-muted">{formatArtifactPreview(artifact)}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid border-b border-ronin-border lg:grid-cols-[2fr_3fr]">
          <div className="border-b border-ronin-border p-5 md:p-8 lg:border-b-0 lg:border-r">
            <SectionLabel>Autonomous activity</SectionLabel>
            <div className="mt-4 grid gap-3">
              {activity.length ? (
                activity.map((event) => <ActivityRow event={event} key={event.id} />)
              ) : (
                <p className="text-sm leading-6 text-ronin-muted">
                  Push events will appear here as Ronin processes diffs and opens PRs.
                </p>
              )}
            </div>
          </div>

          <div className="p-5 md:p-8">
            <SectionLabel>Setup</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Channels and spend controls.</h2>
            <p className="mt-3 text-sm leading-6 text-ronin-muted">
              Connector mappings and provisioning controls are setup actions. They stay out of the main work surface.
            </p>
            <div className="mt-5">
              <ConfigureActions provisioning={provisioning} slack={slack} telegram={telegram} />
            </div>
            <div className="mt-5 grid border border-ronin-border bg-ronin-panel">
              <FactRow label="Slack" value={slack.configured ? (slack.channels.length ? `${slack.channels.length} mapped` : "Configured") : "Not configured"} />
              <FactRow label="Telegram" value={telegram.configured ? (telegram.chats.length ? `${telegram.chats.length} mapped` : "Configured") : "Not configured"} />
              <FactRow label="Spend" value={provisioning ? provisioning.status : "Ready"} />
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-ronin-border px-5 py-4 font-mono text-xs uppercase tracking-[0.22em] text-ronin-muted md:flex-row md:items-center md:justify-between md:px-6">
          <span>Ronin / Agentic solutions engineering</span>
          <span>GitHub App + Hermes + controlled spend</span>
        </footer>
      </div>
    </main>
  );
}

const onboardingSteps = [
  {
    label: "01",
    title: "Create Ronin org",
    body: "Org is the tenant boundary for users, repos, channels, budgets, runs, artifacts, and approvals.",
  },
  {
    label: "02",
    title: "Install GitHub App",
    body: "Grant all or selected repos. Ronin receives webhooks and mints scoped installation tokens.",
  },
  {
    label: "03",
    title: "Map support channels",
    body: "Slack teams, Discord guilds, and Telegram chats/topics resolve to org, repo scope, and capabilities.",
  },
  {
    label: "04",
    title: "Gate risky actions",
    body: "Docs answers can be automatic; PRs, comments, deploys, and Stripe provisioning require policy checks.",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.28em] text-ronin-muted">{children}</p>;
}

function getSingleSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 border-b border-ronin-border px-4 py-3 last:border-b-0 sm:grid-cols-[7rem_1fr]">
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-ronin-muted">{label}</span>
      <span className="break-words font-mono text-sm">{value}</span>
    </div>
  );
}

function RepoCard({
  repo,
}: {
  repo: {
    capabilities: string[];
    fullName: string;
    latestKnownSha: string | null;
  };
}) {
  return (
    <div className="border border-ronin-border bg-ronin-panel p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-mono text-sm font-semibold">{repo.fullName}</h3>
          <p className="mt-2 text-sm leading-6 text-ronin-muted">
            Watching pushes, PRs, support questions, and generated docs.
          </p>
        </div>
        <StatusPill status="done" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-xs text-ronin-muted">
        {repo.capabilities.slice(0, 4).map((capability) => (
          <span className="border border-ronin-border bg-ronin-panel-muted px-2 py-1" key={capability}>
            {capability}
          </span>
        ))}
        {repo.latestKnownSha ? <span className="border border-ronin-border bg-ronin-panel-muted px-2 py-1">{repo.latestKnownSha.slice(0, 7)}</span> : null}
      </div>
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const prUrl = typeof event.metadata.prUrl === "string" ? event.metadata.prUrl : null;
  const label = activityLabel(event.action);

  return (
    <div className="border border-ronin-border bg-ronin-panel p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium">{label}</p>
          <p className="mt-1 font-mono text-xs text-ronin-muted">{event.repo ?? event.target ?? event.actorType}</p>
        </div>
        <time className="font-mono text-xs text-ronin-muted">{formatTime(event.createdAt)}</time>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-xs text-ronin-muted">
        {event.runId ? <span>{event.runId}</span> : null}
        {prUrl ? (
          <a className="font-semibold text-ronin-success underline underline-offset-4" href={prUrl}>
            PR
          </a>
        ) : null}
      </div>
    </div>
  );
}

function activityLabel(action: string) {
  if (action === "github.push") return "Webhook received";
  if (action === "github.pull_request") return "Pull request event";
  if (action === "run.queued") return "Run queued";
  if (action === "run.completed") return "Hermes artifacts stored";
  if (action === "run.blocked") return "Run blocked";
  if (action === "github.pull_request_opened") return "PR opened";
  if (action === "github.pull_request_failed") return "PR failed";
  if (action === "provisioning.plan_created") return "Spend plan created";
  if (action === "provisioning.approved") return "Budget approved";
  return action;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function statusForRun(status: string) {
  if (status === "completed" || status === "done") return "done";
  if (status === "running") return "running";
  if (status === "blocked" || status === "failed") return "blocked";
  return "queued";
}

function runSource(run: DashboardRun) {
  if (run.kind === "github.repository_onboarded") return "GitHub App install";
  if (run.kind.startsWith("github.") && run.input.deliveryId) return "GitHub webhook";
  if (run.kind.startsWith("github.")) return "GitHub App event";
  if (run.kind === "message.workspace_request") {
    const platform = run.input.platform ? capitalize(run.input.platform) : "Support channel";
    return `${platform} request`;
  }
  return "Ronin run";
}

function capitalize(value: string) {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function dedupeArtifacts<T extends { kind: string; title: string }>(artifacts: T[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = `${artifact.kind}:${artifact.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatArtifactPreview(artifact: { content: string; kind: string }) {
  if (artifact.kind !== "github_workspace_patch") return artifact.content;

  try {
    const patch = JSON.parse(artifact.content) as {
      branch?: string;
      changedFiles?: string[];
      commitSha?: string;
      pushed?: boolean;
      testLog?: string;
    };
    const files = patch.changedFiles?.length ? patch.changedFiles.join(", ") : "No files changed";
    const commit = patch.commitSha ? patch.commitSha.slice(0, 12) : "not committed";
    const checkLine = patch.testLog?.includes("403")
      ? "Sandbox checks reached Bun, but registry install returned 403."
      : patch.testLog?.split("\n").find((line) => line.trim()) ?? "Sandbox check log captured.";

    return `Pushed ${patch.pushed ? "yes" : "no"} on ${patch.branch ?? "Ronin branch"} at ${commit}. Changed: ${files}. ${checkLine}`;
  } catch {
    return artifact.content;
  }
}
