# Deployment

## Components

1. **Web app**: `pnpm build && pnpm start` (Node 22+). Any Node host works (Render, Railway, Fly.io, a VM, or Vercel).
2. **PostgreSQL**: Supabase recommended (the database plus Auth). Any PostgreSQL 14+ works for data.
3. **Background processing**: one of:
   - **Worker process** (recommended): `pnpm worker`. It polls every 2 seconds. You can run more than one safely.
   - **Hosted cron** (serverless hosts): call `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.

   Jobs are stored in PostgreSQL, so restarts lose nothing. A browser never needs to be open. `/api/health` reports `worker: lagging` when due jobs are more than 10 minutes overdue.

## Production checklist

- [ ] `APP_MODE=production`, `APP_URL` set to the public HTTPS URL
- [ ] Supabase Auth keys set; redirect URL `APP_URL/auth/callback` allowed
- [ ] `APP_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` generated with a secure RNG and stored in the host's secret manager
- [ ] `pnpm db:migrate` run with the owning role (creates `wf`, `wf_migrations`, the `wf_app` role and RLS policies)
- [ ] Worker or cron tick running; `/api/health` returns `ok`
- [ ] `PLATFORM_ADMIN_EMAILS` set for Infinity Web & Apps staff
- [ ] SMTP configured, and/or WhatsApp app secret and verify token set; studios connect their WhatsApp numbers
- [ ] AI key and model set (optional); pricing variables set if you want cost estimates
- [ ] HTTPS enforced by the host (session cookies are `Secure` in production)
- [ ] Error monitoring: forward server logs (`[jobs]`, `[ai]`, `[webhook]`, `[action]` prefixes) to your log platform; review **Admin → Failures** regularly

Production never seeds sample data. Studios register at `/register` and are guided through onboarding.

## Migrations

```bash
DATABASE_URL=... pnpm db:migrate
```

Migrations are plain SQL in `drizzle/`. `0001_rls.sql` holds the tenant-isolation policies. Review any schema change against it: every new studio-owned table needs `studio_id`, `ENABLE ROW LEVEL SECURITY`, grants to `wf_app` and a `tenant_isolation` policy.

## Backups and recovery

- **Supabase**: enable daily backups (point-in-time recovery on paid plans). Test a restore to a staging project each quarter.
- **Self-hosted Postgres**: run `pg_dump --format=custom --schema=wf --schema=wf_migrations "$DATABASE_URL" > weddingflow-$(date +%F).dump` nightly and copy it off-site. Restore with `pg_restore --clean --if-exists -d "$DATABASE_URL" file.dump`, then run `pnpm db:migrate`.
- Keep `ENCRYPTION_KEY` in your secret manager with its own backup. Without it, stored WhatsApp tokens cannot be decrypted (studios would have to re-enter them; no other data is affected).
- After a restore, pending jobs resume automatically. Idempotency keys stop events from being processed twice, and every send re-checks lead state first.

## Emergency controls

- A studio's **Pause all automation** (Automations page) stops scheduled steps and automated sends immediately.
- Platform admins can **suspend a studio** (closes its enquiry form and blocks access) and **retry dead jobs** from Admin.
- To stop all sending platform-wide, stop the worker and remove the cron trigger. Approved messages stay queued until processing resumes, and each send re-validates first.
