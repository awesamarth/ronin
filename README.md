# Ronin

Ronin is an agentic solutions engineer for protocol teams, devtool companies, and enterprise engineering orgs. It is not trying to replace human solutions engineers; it is meant to offload the repeatable parts of the job: watching repos, keeping docs current, answering builder questions, proposing fixes, opening PRs, and staging infrastructure spend behind approval gates.

Ronin sits around Hermes as the product and control plane. Ronin owns tenants, GitHub App installations, repository routing, support-channel mappings, artifacts, audit logs, and spend policy. Hermes does the reasoning and repo work after Ronin has resolved the right org, repo, channel, and allowed action.

## Video Demo

[Watch the Ronin demo on X](https://x.com/awesamarth_/status/2071708541464011037)

## What It Does

- Watches repositories installed through the Ronin GitHub App.
- Onboards new repos by inspecting code, docs, README state, and package metadata.
- Opens PRs with real workspace edits instead of generated report files.
- Reacts to pushes by comparing diffs, updating docs/changelogs, and refreshing support knowledge.
- Answers Slack and Telegram questions using the mapped repository context.
- Turns maintainer requests in Slack or Telegram into repo changes and PRs.
- Stages Stripe Projects provisioning plans with explicit approval instead of silently spending money.
- Runs repo work inside a NemoHermes/OpenShell sandbox for clone, edit, checks, commit, and push.

## How It Works

### Repository Onboarding

An org installs the Ronin GitHub App and chooses which repositories Ronin can access. GitHub sends an installation webhook, Ronin maps the installation to an org and watched repo, creates a repository onboarding run, and starts Hermes inside the NemoHermes sandbox.

Ronin mints a short-lived GitHub App installation token for that run. The sandbox uses it to clone the repo, run Hermes with the Ronin skill, edit files, run checks, commit to a `ronin/patch-*` branch, and push. Ronin then opens the GitHub PR and stores artifacts for the dashboard and future context.

### Push Handling

When a developer pushes to a watched repo, GitHub sends a push webhook with the before and after SHAs. Ronin fetches the compare diff, creates a `github.push` run, and gives Hermes the repo context plus the change summary.

Hermes can identify docs drift, API changes, changelog entries, broken examples, or support knowledge updates. If a follow-up is needed, the sandbox edits the repository and Ronin opens another PR.

### Slack And Telegram

Support channels are mapped to repositories in Ronin's database. A Slack channel or Telegram chat does not rely on Hermes memory to guess the repo. Ronin resolves the platform team/chat/channel ID to an org and default repository first.

If the message is a question, Ronin passes scoped repo artifacts and context to Hermes and replies in the channel. If the message is an action request, such as "add a helper method" or "fix the README", Ronin routes it to the workspace runner so Hermes can edit the repo and Ronin can open a PR.

### Spend And Provisioning

Ronin includes a staged Stripe Projects flow for provisioning resources such as hosted services. Hermes can produce a concrete provisioning plan and command, but the demo path records it as approval-required and non-executed. The point is to show that the agent can plan real operational spend while Ronin keeps execution behind policy.

## Architecture

```text
GitHub App / Slack / Telegram
        |
        v
Ronin dashboard and API
  - org, repo, and channel routing
  - GitHub webhook verification
  - short-lived GitHub App tokens
  - run/artifact/audit storage
  - provisioning approval gates
        |
        v
NemoHermes / OpenShell sandbox
  - clone repository
  - run Hermes with Ronin skill
  - edit code/docs/changelog
  - run checks
  - commit and push branch
        |
        v
GitHub PR / Slack reply / Telegram reply / dashboard artifacts
```

## Apps

- `apps/dashboard`: Next.js control plane for GitHub App state, watched repos, latest agent work, support-channel mappings, and staged provisioning.
- `apps/docs`: Fumadocs documentation surface.
- `skills/ronin`: Hermes skill used during Ronin repo work.

## Local Setup

Ronin uses Bun workspaces.

```bash
bun install
bun run lint
bun run build
```

Run the dashboard:

```bash
bun run dev:dashboard
```

Run the docs app:

```bash
bun run dev:docs
```

Useful dashboard scripts:

```bash
bun run --cwd apps/dashboard db:generate
bun run --cwd apps/dashboard db:migrate
bun run --cwd apps/dashboard db:seed
bun run --cwd apps/dashboard github:worker
bun run --cwd apps/dashboard slack:connector
bun run --cwd apps/dashboard telegram:connector
```

## Environment

Copy the dashboard example env and fill in real credentials:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
```

Important values:

- `DATABASE_URL`: local SQLite by default.
- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_WEBHOOK_SECRET`: GitHub App configuration.
- `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH`: private key used only on the backend.
- `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`: Slack Socket Mode connector.
- Telegram token variables if running the Telegram connector.
- NemoHermes/OpenShell settings for sandbox execution.

Do not expose the GitHub private key, Slack tokens, Telegram token, database, or local `key.pem` to the browser or commit them to Git.

## Demo Status

The current demo path is real for:

- GitHub App installation sync.
- GitHub webhooks for repository onboarding and pushes.
- Sandbox clone/edit/check/commit/push.
- PR creation from Ronin branches.
- Slack and Telegram channel-to-repo routing.
- Slack action requests opening code/docs PRs.
- Staged Stripe provisioning plans.

The current local build is still a hackathon prototype. Production deployment still needs a hosted database, a deployed dashboard/webhook URL, long-running connector/worker processes, auth/tenant isolation for external users, and a queue-backed worker model for heavier runs.

## Positioning

Ronin is best understood as an agentic solutions engineer, not just a docs bot. Docs are one output. The broader product is an always-on engineering teammate that understands a company's repositories, support channels, and operational boundaries well enough to propose and execute useful work through reviewable PRs.
