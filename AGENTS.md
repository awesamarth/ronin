# AGENTS.md

This file is for coding agents working on Ronin after cloning the repo. It is not the private hackathon scratchpad. Treat it as the operational guide for making safe, useful changes.

## Project Shape

Ronin is a Bun workspace with two Next.js apps:

- `apps/dashboard`: the main Ronin control plane.
- `apps/docs`: the Fumadocs documentation app.
- `skills/ronin`: the Hermes skill used by the sandbox runner.

Ronin's core responsibility is routing and control: orgs, GitHub installations, watched repos, channel mappings, run records, artifacts, audit logs, and approval gates. Hermes handles reasoning and edits only after Ronin has resolved the target context.

## Commands

Use Bun, not npm or pnpm, unless a target repository being inspected requires something else.

```bash
bun install
bun run lint
bun run build
bun run dev:dashboard
bun run dev:docs
```

Dashboard-specific commands:

```bash
bun run --cwd apps/dashboard db:generate
bun run --cwd apps/dashboard db:migrate
bun run --cwd apps/dashboard db:seed
bun run --cwd apps/dashboard github:worker
bun run --cwd apps/dashboard slack:connector
bun run --cwd apps/dashboard telegram:connector
```

## Safety Rules

- Never commit `.env`, `*.db`, `key.pem`, `node_modules`, `.next`, `.source`, or local sandbox state.
- Never put GitHub App private keys, Slack tokens, Telegram tokens, or Stripe credentials in client components or `NEXT_PUBLIC_*` variables.
- GitHub App private key handling belongs on the server side only.
- Do not make the sandbox use a long-lived token when a short-lived GitHub App installation token is available.
- Stripe provisioning should stay approval-gated unless an explicit product change adds a real execution gate.
- Keep generated demo scratch files out of the public repo unless the user explicitly asks to publish them.

## Implementation Notes

- GitHub webhook handling lives under `apps/dashboard/src/app/api/github/webhooks`.
- GitHub App token and installation helpers live in `apps/dashboard/src/lib/github-app.ts`.
- GitHub run processing lives in `apps/dashboard/src/lib/github-run-processor.ts`.
- Sandbox workspace execution lives in `apps/dashboard/src/lib/github-workspace-runner.ts`.
- Slack and Telegram message routing lives in `apps/dashboard/src/lib/message-ingest.ts`.
- Provisioning planning lives in `apps/dashboard/src/lib/provisioning.ts`.
- Dashboard data loading lives in `apps/dashboard/src/lib/dashboard-data.ts`.
- Prisma schema lives in `apps/dashboard/prisma/schema.prisma`.

## Product Behavior To Preserve

- Installing the GitHub App should be enough to start watching accessible repos.
- Repository onboarding should create a run and, when useful, open a PR with real file changes.
- Push webhooks should compare diffs and update docs/changelogs/support artifacts when needed.
- Slack and Telegram must resolve channel/chat mappings before invoking Hermes.
- Action requests from mapped support channels should open PRs rather than editing main directly.
- Ronin should store artifacts and context in its own database; do not rely only on Hermes session memory.

## UI Direction

The dashboard is an operator console, not a marketing landing page.

- Keep the first screen dense and useful.
- Avoid fake demo buttons, oversized marketing sections, decorative gradients, glows, or glassmorphism.
- Prefer flat panels, thin borders, compact labels, and real operational state.
- Modals are appropriate for setup details such as Slack, Telegram, and spend controls.
- The watched repositories and latest agent work sections should reflect real DB state.

## Verification

For code changes, run the narrowest useful checks first, then broaden if the change touches shared behavior:

```bash
bun run lint
bun run build
```

For GitHub/connector changes, also verify the relevant worker or connector path manually. A change is not complete just because the dashboard renders.

For sandbox behavior, confirm whether the work happened inside NemoHermes/OpenShell before claiming it did.
