# Architecture notes

## Tenant isolation

- Every studio-owned row carries `studio_id`.
- Requests run inside `withStudio(studioId, fn)`. It opens a transaction, sets `app.studio_id`, then runs `SET LOCAL ROLE wf_app`. `wf_app` has no `BYPASSRLS`, and each table's policy is `studio_id = wf.current_studio_id()`, so a missing `WHERE` clause cannot leak another studio's rows. Integration tests prove that reads, updates and inserts across tenants fail.
- Code that must work across studios (job workers, webhooks, enquiry intake lookup, platform admin) uses `asSystem` and filters explicitly. Platform-only tables (`webhook_events`, `local_auth_users`, `rate_limits`, `support_notes`) have no grants for `wf_app` at all.
- Services check roles on the server; the UI hiding controls is only a convenience.

## Durable automation

```
business change ──(same transaction)──▶ jobs: automation.dispatch  (idempotency key per event)
dispatch ──▶ automation_runs (unique rule+event) + jobs: automation.execute @ scheduled time
execute ──▶ re-check rule enabled, studio not paused, lead exists, conditions still true
        ──▶ dry run? record planned actions : perform actions atomically in an RLS-scoped transaction
sweep (every 5 min) ──▶ follow_up_due, consultation_approaching, quotation_awaiting_response,
                        event_date_approaching, lead_inactive events; quotation expiry; retention
```

Events produced by automation carry a depth; anything deeper than 2 is dropped, which stops loops. Failed jobs retry with exponential backoff and jitter, then become `dead` and appear in Admin → Failures.

## Messaging safety

1. Drafts (manual, AI or automation) start at `awaiting_approval`.
2. Approval sets the message to `queued` and enqueues `message.send` (idempotent per message).
3. The send job locks the message row, re-checks the send policy, marks it `sending`, calls the provider outside the transaction, then records `sent` with the provider message id. Transient errors go back to `queued` and retry; permanent rejections become `failed`.
4. Delivery is only recorded as `delivered` from a provider webhook. Status updates never go backwards.
5. Demo mode and demo studios always resolve to the demo adapter.

## AI guardrails

- The model sees an explicit JSON context: studio services with prices (or "price on request"), the enquiry and recent history. The system prompt forbids inventing prices, policies, availability or booking confirmation.
- Output is requested from xAI Grok as JSON-schema structured output and validated again with Zod on our side. Refusals, truncated and malformed output are errors.
- Reply drafts are scanned for currency amounts that match no configured price, and each one is flagged to the approver.
- Quotation drafts: the model picks only service ids and quantities. Unknown ids are discarded, and prices and totals come from the database and the deterministic calculator.
- Each call is rate-limited per studio and recorded in `ai_usage` (also on failure, on a separate connection). When AI is unavailable the app keeps working, and automations fall back to templates.
