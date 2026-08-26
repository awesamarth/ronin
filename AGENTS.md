# AGENTS.md

This file is for coding agents working on Ronin after cloning the repo. It is not the private hackathon scratchpad. Treat it as the operational guide for making safe, useful changes.

## Project Shape

Ronin is a Bun workspace with two Next.js apps:

- `apps/dashboard`: the main Ronin control plane.
- `apps/docs`: the Fumadocs documentation app.
- `skills/ronin`: the Ronin skill used by the execution agent.

Ronin's core responsibility is routing and control: orgs, GitHub installations, watched repos, channel mappings, run records, artifacts, audit logs, and product policy. PostgreSQL is required. The operator console uses GitHub OAuth plus organization membership; an optional login allowlist gates private-beta admission only. The execution agent handles reasoning and edits only after Ronin has resolved the target context. Repo execution is delegated to Centaur; Ronin is harness-agnostic.

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
- Never put GitHub App private keys, Slack tokens, Telegram tokens, or hosted-model API keys in client components or `NEXT_PUBLIC_*` variables.
- GitHub App private key handling belongs on the server side only.
- Never pass a GitHub installation token through prompts, metadata, session messages, generic Centaur execution requests, logs, or artifacts. Workspace tokens may cross only the authenticated Iron Control secret API as an encrypted, exact-repository, principal-bound credential and must be deleted after execution.
- Treat `CENTAUR_API_KEY` as a privileged service credential. Until Centaur has a scoped `ronin:` ingress identity, it must be admin- or Console-capable and stay server-only.
- Keep generated demo scratch files out of the public repo unless the user explicitly asks to publish them.

## Implementation Notes

- GitHub webhook handling lives under `apps/dashboard/src/app/api/github/webhooks`.
- GitHub App token and installation helpers live in `apps/dashboard/src/lib/github-app.ts`.
- GitHub run processing lives in `apps/dashboard/src/lib/github-run-processor.ts`.
- Centaur client lives in `apps/dashboard/src/lib/centaur-client.ts`.
- Workspace execution lives in `apps/dashboard/src/lib/github-workspace-runner.ts`; exact-repository token attachment and cleanup live in `apps/dashboard/src/lib/github-credential-broker.ts`.
- Slack and Telegram message routing lives in `apps/dashboard/src/lib/message-ingest.ts`.
- Dashboard data loading lives in `apps/dashboard/src/lib/dashboard-data.ts`.
- Prisma schema lives in `apps/dashboard/prisma/schema.prisma`.
- `UserIdentity` maps provider accounts to a Ronin user; `OrgMembership` is the tenant boundary with owner/admin/member/external roles. Every user-facing query must start from the authenticated active membership and include its `orgId`.
- Internal Slack channels auto-provision full home-workspace users as members. External Slack channels auto-provision external users; guests and Slack Connect users never receive internal membership implicitly. Explicitly mapped Telegram chats use their configured internal/external audience as the membership trust boundary.
- `Conversation` and `ConversationMessage` own platform-thread continuity. `Run` is one logical Ronin job and carries an immutable actor/action authorization snapshot; `AgentExecution` is one idempotent model/agent invocation within that job; `Artifact` is durable output. Do not collapse these responsibilities back together.

## Product Behavior To Preserve

- Installing the GitHub App should be enough to start watching accessible repos.
- Repository onboarding should create a run and, when useful, open a PR with real file changes.
- Push webhooks should compare diffs and update docs/changelogs/support artifacts when needed.
- Slack channel mentions and Telegram messages must resolve channel/chat mappings before invoking Centaur. Slack DMs resolve the workspace installation: connected installations use Centaur with org context; unconnected installations use the direct inference-only public profile.
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

- Add a persistent `WorkItem` only when Ronin implements an actionable multi-step lifecycle spanning conversations, runs, review, and resolution; do not use `Run` as that lifecycle object.
- Add authorized Slack thread commands for inspecting and overriding harness, model, provider, and reasoning (`/ronin settings`, `/ronin model`, `/ronin reasoning`, `/ronin reset`). Public/external users must remain on operator-controlled defaults.
- Split PostgreSQL access into tenant and system roles, then enable forced RLS using transaction-scoped org context. Current protection is centralized membership authorization, mandatory org-scoped queries, same-org database triggers, and cross-tenant tests; do not add an unscoped user-facing query.
- Add an operator-approved public profile and external artifact visibility, then route external channels through tool-free hosted inference. External mapped execution remains fail-closed until that boundary exists.
- Add owner-managed membership invitations for users who have not interacted with Ronin yet.
- Add verified identity linking so one person can explicitly join their GitHub and Slack identities; never auto-link by display name or unverified email.
- Centaur deployments serving Ronin must set `default_sandbox_repo_cache=none`; Ronin rejects any reported conflicting capability. Never re-enable a shared repository cache for tenant executions. Broker exact short-lived repository credentials into the individual session before private repository work.
- Replace manual DM channel-ID mappings with an authorized onboarding and repository-selection flow.
- Replace the single-workspace Slack bot-token setup with Slack OAuth installations and encrypted per-workspace bot credentials for production multi-workspace SaaS.
- Add organization-level hosted inference billing and BYOK, followed by compatible BYOM endpoints when customers require them.
- Replace the local demo's non-expiring static Centaur admin credential with a least-privilege `ronin:` service identity before production; tenant authorization remains in Ronin and per-session sandbox scope.
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
