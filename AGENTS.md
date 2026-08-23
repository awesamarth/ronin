# AGENTS.md

This file is for coding agents working on Ronin after cloning the repo. It is not the private hackathon scratchpad. Treat it as the operational guide for making safe, useful changes.

## Project Shape

Ronin is a Bun workspace with two Next.js apps:

- `apps/dashboard`: the main Ronin control plane.
- `apps/docs`: the Fumadocs documentation app.
- `skills/ronin`: the Ronin skill used by the execution agent.

Ronin's core responsibility is routing and control: orgs, GitHub installations, watched repos, channel mappings, run records, artifacts, audit logs, and product policy. PostgreSQL is required. The operator console uses allowlisted GitHub OAuth. The execution agent handles reasoning and edits only after Ronin has resolved the target context. Repo execution is delegated to Centaur; Ronin is harness-agnostic.

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
- Never put GitHub App private keys, Slack tokens, or Telegram tokens in client components or `NEXT_PUBLIC_*` variables.
- GitHub App private key handling belongs on the server side only.
- Never pass a GitHub installation token through prompts, metadata, session messages, or the Centaur API. Ronin uses its GitHub App token server-side for compare and PR API calls.
- Treat `CENTAUR_API_KEY` as a privileged service credential. Until Centaur has a scoped `ronin:` ingress identity, it must be admin- or Console-capable and stay server-only.
- Keep generated demo scratch files out of the public repo unless the user explicitly asks to publish them.

## Implementation Notes

- GitHub webhook handling lives under `apps/dashboard/src/app/api/github/webhooks`.
- GitHub App token and installation helpers live in `apps/dashboard/src/lib/github-app.ts`.
- GitHub run processing lives in `apps/dashboard/src/lib/github-run-processor.ts`.
- Centaur client lives in `apps/dashboard/src/lib/centaur-client.ts`.
- Workspace execution lives in `apps/dashboard/src/lib/github-workspace-runner.ts`.
- Slack and Telegram message routing lives in `apps/dashboard/src/lib/message-ingest.ts`.
- Dashboard data loading lives in `apps/dashboard/src/lib/dashboard-data.ts`.
- Prisma schema lives in `apps/dashboard/prisma/schema.prisma`.

## Product Behavior To Preserve

- Installing the GitHub App should be enough to start watching accessible repos.
- Repository onboarding should create a run and, when useful, open a PR with real file changes.
- Push webhooks should compare diffs and update docs/changelogs/support artifacts when needed.
- Slack and Telegram must resolve channel/chat mappings before invoking the Centaur execution seam.
- Action requests from mapped support channels should open PRs rather than editing main directly.
- Ronin should store artifacts and context in its own database; do not rely only on agent session memory.

## UI Direction

The dashboard is an operator console, not a marketing landing page.

- Keep the first screen dense and useful.
- Avoid fake demo buttons, oversized marketing sections, decorative gradients, glows, or glassmorphism.
- Prefer flat panels, thin borders, compact labels, and real operational state.
- Modals are appropriate for setup details such as Slack and Telegram.
- The watched repositories and latest agent work sections should reflect real DB state.

## TODO

- Add authorized Slack thread commands for inspecting and overriding harness, model, provider, and reasoning (`/ronin settings`, `/ronin model`, `/ronin reasoning`, `/ronin reset`). Public/external users must remain on operator-controlled defaults.
- Add organization memberships and roles so public users, external support users, internal members, and operators receive explicitly different repository, knowledge, and action permissions.
- Replace manual DM channel-ID mappings with an authorized onboarding and repository-selection flow.
- Add a restricted public-conversation execution profile that cannot access company repositories, tools, or credentials; prompt instructions alone are not a security boundary.
- Add a scoped `ronin:` Centaur service identity and renewable authentication instead of Console/admin-capable temporary credentials.
- Broker narrowly scoped GitHub write credentials to Centaur for authorized branch pushes without exposing GitHub App installation tokens.
- Finish hosted operations: production OAuth callback, TLS proxy, database backups/restores, process supervision, monitoring, and log collection.
- Validate Telegram live without contacting existing users unexpectedly.

## Verification

For code changes, run the narrowest useful checks first, then broaden if the change touches shared behavior:

```bash
bun run lint
bun run build
```

For GitHub/connector changes, also verify the relevant worker or connector path manually. A change is not complete just because the dashboard renders.

For execution behavior, confirm whether the work happened through Centaur before claiming it did.
