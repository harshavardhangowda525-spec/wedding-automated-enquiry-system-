# WeddingFlow AI

**Every enquiry tracked. Every follow-up remembered.**
Enquiry and follow-up automation for wedding photography and cinematography studios, a product by **Infinity Web & Apps**.

WeddingFlow AI centralises enquiries, helps staff respond professionally and on time, automates repetitive follow-up work and never sends a message that a person (or a narrowly scoped, explicitly enabled automation) has not approved.

## Features

| Area | What you get |
| --- | --- |
| Public enquiry form | Branded `/enquire/<studio>` page; configurable optional fields; consent capture; signed anti-spam token, honeypot, rate limiting, duplicate detection; reference number; "received, not booked" confirmation |
| Lead CRM | `/leads` table and pipeline views, search & filters, pagination, bulk actions with per-lead validation, CSV export (admins, audited), lead detail with timeline, notes, tags, assignment, contact logging, deposit recording, validated stage transitions |
| Follow-ups & calendar | Task workspace (overdue / today / upcoming), month/week/day calendar, consultations, holds, bookings, quotation expiries; availability derived only from recorded data; conflict warnings |
| AI assistant (xAI Grok) | Enquiry & conversation summaries, reply/follow-up drafts, priority suggestion with explanation, next-step suggestion, quotation drafts built from configured prices only. Schema-validated output, timeouts, bounded retries, per-studio rate limits, usage tracking, graceful "AI unavailable" behaviour |
| Automation engine | Durable Postgres job queue (survives restarts, `SKIP LOCKED`, idempotency keys, exponential backoff, dead-lettering, stale-lock recovery). Rules with triggers, conditions, actions, delays in business days, business-hours windows, dry-run, execution history, loop protection and a studio-wide pause switch |
| Messaging | WhatsApp Business Platform Cloud API (templates, 24-hour window, signed webhooks, idempotent status/inbound processing, STOP opt-out) and SMTP email. Accurate states (draft → awaiting approval → queued → sending → sent → delivered/failed/skipped/cancelled). Demo adapter labels every simulated send "Demo — not sent" |
| Quotations | Branded builder, deterministic server-side totals in paise (discounts, GST, deposit, milestones), approval → sent → accepted/rejected/expired, PDF export. Acceptance never auto-confirms a booking |
| Analytics | Database-backed metrics with written definitions and date ranges, no seeded production numbers |
| Multi-tenancy & security | PostgreSQL row-level security through a restricted `wf_app` role, server-side role checks (owner/admin/staff/viewer), encrypted integration secrets, audit log, hashed IPs, retention settings, full data export |
| Platform admin | Studios, integration status, automation health, dead jobs with retry, failed sends, webhook errors, AI usage and cost estimates (when pricing is configured), support notes, audit events (admin access to a studio is itself audited) |

## Tech stack

Next.js 16 (App Router, server actions) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL (Supabase-compatible) via Drizzle ORM · Supabase Auth (`@supabase/ssr`) · Zod · xAI Grok API (Chat Completions, structured outputs) · nodemailer · pdf-lib · Vitest · Playwright.

## Quick start (local demo)

Requirements: Node 22+, pnpm 10+, PostgreSQL 14+.

```bash
pnpm install
cp .env.example .env            # then set DATABASE_URL, APP_SECRET, ENCRYPTION_KEY, CRON_SECRET
pnpm db:migrate                 # creates the wf schema, RLS policies and the wf_app role
pnpm demo:seed                  # sample studios, users and leads (demo mode only)
pnpm build && pnpm start        # web app on http://localhost:3000
pnpm worker                     # in a second terminal: durable background worker
```

Demo logins (local demo auth, password `weddingflow-demo`):

| Email | Role |
| --- | --- |
| `owner@aurora.demo` | Owner of *Aurora Wedding Films (Sample)* |
| `staff@aurora.demo` | Staff at Aurora |
| `owner@lumiere.demo` | Owner of a second sample studio (for tenant-isolation demos) |
| `admin@infinitywebapps.demo` | Infinity Web & Apps platform admin |

Public sample form: `http://localhost:3000/enquire/aurora-films-demo`. Reset the demo at any time with `pnpm demo:reset` (refuses to run in production mode).

> When Supabase keys are not set **and** `APP_MODE=demo`, a local demo login is used so the product can be demonstrated offline. Production mode refuses to start without Supabase Auth.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm worker` | Background worker (automation, sends, sweeps) |
| `pnpm db:migrate` | Apply SQL migrations |
| `pnpm db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `pnpm demo:seed` / `pnpm demo:reset` | Load / recreate sample data (demo mode only) |
| `pnpm lint` · `pnpm typecheck` | Static checks |
| `pnpm test` | Unit + integration tests (needs a Postgres database whose name contains `test`) |
| `pnpm test:e2e` | Playwright end-to-end tests against a running, seeded demo app |

Integration tests use `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/weddingflow_test`) and rebuild the schema on every run.

## Project layout

```
src/app/(public)        landing, login, register
src/app/enquire         public enquiry form
src/app/(app)           authenticated studio workspace
src/app/admin           platform administration
src/app/api             webhooks, cron tick, exports, PDF, health
src/app/actions         server actions (thin, validated, role-checked)
src/server/db           Drizzle schema, RLS-scoped client (withStudio / asSystem)
src/server/auth         Supabase + local demo auth, studio context & roles
src/server/services     domain services (leads, enquiries, tasks, calendar, quotations, analytics, settings, admin)
src/server/automation   rule engine, conditions, periodic sweep
src/server/messaging    adapters (WhatsApp Cloud, SMTP, demo), send policy, webhooks
src/server/ai           provider abstraction (xAI Grok) + AI features
src/server/jobs         durable job queue and handlers
drizzle/                SQL migrations (0001_rls.sql holds the tenant-isolation policies)
scripts/                migrate, worker, demo seed
tests/                  unit, integration (real Postgres) and e2e (Playwright)
```

## Documentation

- [docs/CONFIGURATION.md](docs/CONFIGURATION.md): every environment variable, Supabase, WhatsApp, email and AI setup
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production deployment, the scheduler, backups and recovery
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): tenant isolation, automation engine, messaging safety and AI guardrails
