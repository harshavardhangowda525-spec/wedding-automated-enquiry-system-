# Configuration

All configuration is through environment variables (see `.env.example`). All values, including the Supabase URL and key, are read only on the server and never sent to the browser.

## Core

| Variable | Required | Description |
| --- | --- | --- |
| `APP_MODE` | yes | `demo` (sample data, simulated messaging, local login allowed) or `production` (Supabase required, real sends, demo seeding refused). |
| `APP_URL` | yes | Public base URL, used for enquiry links, webhook URL and auth callbacks. |
| `DATABASE_URL` | yes | PostgreSQL connection string for the **owning** role (e.g. `postgres` on Supabase). Requests switch to the restricted `wf_app` role per transaction. On Supabase use the *session* or *transaction* pooler URL. |
| `DATABASE_POOL_SIZE` | no | Connection pool size per process (default 10). |
| `APP_SECRET` | yes | ≥32 random characters. Signs local demo sessions and enquiry anti-spam tokens; keys the IP hash. |
| `ENCRYPTION_KEY` | production | Base64 of 32 random bytes (`openssl rand -base64 32`). Encrypts per-studio integration secrets (AES-256-GCM). Rotating it makes stored tokens unreadable, so studios must re-enter them. |
| `CRON_SECRET` | production | Bearer token for `/api/cron/tick`. |
| `PLATFORM_ADMIN_EMAILS` | no | Comma-separated emails granted platform administration when they sign in. Admin status is never self-assigned. |

## Supabase Auth

1. Create a Supabase project. In **Authentication → URL configuration** set the Site URL to `APP_URL` and add `APP_URL/auth/callback` as a redirect URL.
2. Set `SUPABASE_URL` (the Project URL, e.g. `https://abcdefgh.supabase.co`) and `SUPABASE_ANON_KEY` (the anon / publishable key) from Project settings → API. The older `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` names are still accepted.
3. Email confirmation may be on or off. When it is on, users confirm via the emailed link (handled by `/auth/callback`) and then create their studio.
4. Application data lives in the `wf` schema, which Supabase's REST API does not expose. All tables additionally have row-level security; the `anon` and `authenticated` roles have no grants on them.

The app verifies every request with `supabase.auth.getUser()` (a server round-trip to Supabase), not by trusting the cookie. `src/proxy.ts` refreshes session cookies.

## AI (optional)

| Variable | Default | Description |
| --- | --- | --- |
| `AI_PROVIDER` | `xai` | `none` disables AI everywhere. |
| `XAI_API_KEY` | – | xAI API key. Without it, AI features show "AI unavailable" and automations fall back to studio templates. |
| `AI_MODEL` | – (required) | A Grok model identifier enabled for your key, copied from the xAI console's model list. There is no built-in default, so the app never guesses a model name. |
| `AI_BASE_URL` | `https://api.x.ai/v1` | xAI API base URL. Requests go to `{AI_BASE_URL}/chat/completions`. |
| `AI_TIMEOUT_MS` | 30000 | Per-request timeout. |
| `AI_MAX_RETRIES` | 2 | Retries with exponential backoff for 408/409/429/5xx and network errors. |
| `AI_RATE_LIMIT_PER_HOUR` | 120 | Per-studio AI calls per hour. |
| `AI_PRICE_INPUT_PER_MTOK_USD`, `AI_PRICE_OUTPUT_PER_MTOK_USD` | – | Set from current provider pricing to show cost estimates in platform admin. When unset, no estimate is shown. |

Studios can turn AI off in **Settings → AI, data & privacy**; then no enquiry data is sent to xAI. Requests use JSON-schema structured outputs (`response_format: json_schema`, `strict: true`), and every response is validated again with Zod before use.

## WhatsApp Business Platform (Cloud API)

Server variables:

| Variable | Description |
| --- | --- |
| `WHATSAPP_VERIFY_TOKEN` | Any random string; enter the same value in the Meta app's webhook settings. |
| `WHATSAPP_APP_SECRET` | The Meta app secret, used to verify `X-Hub-Signature-256` on every webhook. Webhooks are rejected without it. |
| `WHATSAPP_GRAPH_VERSION` | Graph API version, default `v23.0`. |

Per studio (Settings → Integrations, owners only): phone number ID, optional WABA ID and a permanent system-user access token (stored encrypted). "Test connection" calls the Graph API to read the phone number. It does not send a message.

Meta app setup: Webhooks → WhatsApp Business Account → callback `APP_URL/api/webhooks/whatsapp`, verify token as above, subscribe to `messages`.

Rules enforced before every send: consent recorded, not opted out, lead still relevant, no identical message in 7 days, automated-message limits and spacing, business hours for automated sends, and the 24-hour customer-service window (outside it only approved templates can be sent). Inbound "STOP"/"unsubscribe" replies opt the client out and cancel pending messages.

## Email (SMTP)

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. Messages go from `EMAIL_FROM` with the studio name as display name and the studio email as Reply-To. SMTP acceptance is recorded as **Sent**; email is never marked Delivered, because SMTP does not confirm inbox delivery.

## Demo safety

In `APP_MODE=demo`, and for any studio flagged `is_demo` in any mode, every send goes through the demo adapter. It records the message, contacts nobody and labels it "Demo — not sent". Demo seeding and resetting refuse to run when `APP_MODE=production`. Sample records show a "Sample" badge, and analytics warns when sample records are in range.
