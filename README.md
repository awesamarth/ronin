# Ronin

Ronin is an agentic solutions engineer for protocol teams, devtool companies, and enterprise engineering orgs. It is not trying to replace human solutions engineers; it is meant to offload the repeatable parts of the job: watching repos, keeping docs current, answering builder questions, proposing fixes, and opening PRs.

Ronin sits around the execution agent as the product and control plane. Ronin owns tenants, GitHub App installations, repository routing, support-channel mappings, artifacts, audit logs, and product policy. The agent does the reasoning and repo work after Ronin has resolved the right org, repo, channel, and allowed action. Repo execution is delegated to Centaur: the operator must configure Centaur with a scoped GitHub token, after which it clones repos, runs checks, commits, and pushes.

## What It Does

- Watches repositories installed through the Ronin GitHub App.
- Onboards new repos by inspecting code, docs, README state, and package metadata.
- Opens PRs with real workspace edits instead of generated report files.
- Reacts to pushes by comparing diffs, updating docs/changelogs, and refreshing support knowledge.
- Answers Slack and Telegram questions using the mapped repository context.
- Turns maintainer requests in Slack or Telegram into repo changes and PRs.
- Runs repo work (clone, edit, checks, commit, push) through Centaur.

## How It Works

### Repository Onboarding

An org installs the Ronin GitHub App and chooses which repositories Ronin can access. GitHub sends an installation webhook, Ronin maps the installation to an org and watched repo, creates a repository onboarding run, and starts a Centaur execution.

The Centaur agent clones the repo using its operator-configured `GITHUB_TOKEN`, edits files, runs checks, commits to a `ronin/patch-*` branch, and pushes. Ronin then uses its own GitHub App installation token server-side to open the GitHub PR and stores artifacts for the dashboard and future context.

### Push Handling

When a developer pushes to a watched repo, GitHub sends a push webhook with the before and after SHAs. Ronin fetches the compare diff, creates a `github.push` run, and gives the agent the repo context plus the change summary.

The agent can identify docs drift, API changes, changelog entries, broken examples, or support knowledge updates. If a follow-up is needed, a Centaur workspace run edits the repository and Ronin opens another PR.

### Slack And Telegram

Support channels are mapped to repositories in Ronin's database. A Slack channel or Telegram chat does not rely on the agent's memory to guess the repo. Ronin resolves the platform team/chat/channel ID to an org and default repository first, then invokes the Centaur execution seam.

If the message is a question, Ronin passes scoped repo artifacts and context to the agent and replies in the channel. If the message is an action request, such as "add a helper method" or "fix the README", Ronin routes it to the workspace runner so the agent can edit the repo and Ronin can open a PR.

## Architecture

```text
GitHub App / Slack / Telegram
        |
        v
Ronin dashboard and API
  - org, repo, and channel routing
  - GitHub webhook verification
  - short-lived GitHub App tokens (server-side)
  - run/artifact/audit storage
        |
        v
Centaur execution
  - clone repository (operator-configured GITHUB_TOKEN)
  - run agent with Ronin skill
  - edit code/docs/changelog
  - run checks
  - commit and push branch
        |
        v
GitHub PR / Slack reply / Telegram reply / dashboard artifacts
```

## Apps

- `apps/dashboard`: Next.js control plane for GitHub App state, watched repos, latest agent work, and support-channel mappings.
- `apps/docs`: Fumadocs documentation surface.
- `skills/ronin`: skill used during Ronin repo work.

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

- `DATABASE_URL`: required PostgreSQL connection string.
- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`: GitHub App and operator OAuth configuration. Set the callback URL to `/api/auth/github/callback` on `RONIN_BASE_URL`.
- `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH`: private key used only on the backend.
- `RONIN_SESSION_SECRET`, `RONIN_ALLOWED_GITHUB_USERS`: signed operator sessions and the GitHub-login allowlist.
- `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`: Slack Socket Mode connector.
- Telegram token variables if running the Telegram connector.
- `CENTAUR_API_URL`, `CENTAUR_API_KEY`: Centaur execution backend configuration. `ronin:*` sessions currently require an admin- or Console-capable credential; a Slack ingress key is prefix-restricted and will not work.
- `RONIN_HARNESS`: fallback harness (defaults to `pi`); repositories may override harness/model/provider/reasoning.
- Optional `RONIN_MODEL`, `RONIN_PROVIDER`, `RONIN_REASONING`, `CENTAUR_TIMEOUT_MS`.

Do not expose the GitHub private key, Slack tokens, Telegram token, database, or local `key.pem` to the browser or commit them to Git.

## Docker deployment

The default stack runs PostgreSQL, migrations, dashboard, docs, and the durable GitHub worker:

```bash
export POSTGRES_PASSWORD="$(openssl rand -hex 32)"
docker compose up -d postgres migrate dashboard github-worker docs
```

Run connectors only when their credentials are configured:

```bash
docker compose --profile slack up -d slack
# Or, when Telegram is configured:
docker compose --profile telegram up -d telegram
```

For a hosted deployment, set a strong `RONIN_SESSION_SECRET`, `RONIN_ALLOWED_GITHUB_USERS`, public `RONIN_BASE_URL`, and `GITHUB_APP_PRIVATE_KEY` in `apps/dashboard/.env`; terminate TLS at a reverse proxy and back up the `postgres-data` volume. The image never copies local env files or `key.pem`.

## Status

The current build is real for:

- GitHub App installation sync.
- GitHub webhooks for repository onboarding and pushes.
- Centaur-driven clone/edit/check/commit/push.
- PR creation from Ronin branches.
- Slack and Telegram channel-to-repo routing.
- Slack action requests opening code/docs PRs.

The dashboard now requires PostgreSQL and allowlisted GitHub OAuth. GitHub work is atomically claimed by the worker and safely retried through Centaur idempotency. Deployment still needs hosted process supervision, a public webhook URL, per-customer operator membership beyond the current allowlist, and a scoped Centaur `ronin:` service identity instead of an admin-capable credential.

## Positioning

Ronin is best understood as an agentic solutions engineer, not just a docs bot. Docs are one output. The broader product is an always-on engineering teammate that understands a company's repositories, support channels, and operational boundaries well enough to propose and execute useful work through reviewable PRs.
