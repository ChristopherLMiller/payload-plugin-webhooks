---
'payload-plugin-webhooks': minor
---

Add outbound webhooks: HTTP requests sent to other services when documents change.

- New **Webhook Endpoints** collection: URL, method, which collections and operations trigger it, authentication (none, Bearer, Basic, custom header), optional HMAC signing secret, extra headers, timeout, and whether to include the document.
- Documents are read as each endpoint's **Run as** user, so receivers only get what that user may read. Users can only run endpoints as themselves unless `outbound.assignRunAs` allows otherwise.
- Delivery uses Payload's jobs queue (`webhooks` queue): queued in the same transaction as the change, started right after commit, retried with exponential backoff (`outbound.retries`, default 5). Retries run in-process every minute by default (`outbound.autoRun`); set it to `false` on serverless and call `/api/payload-jobs/run?queue=webhooks` instead.
- New **Webhook Deliveries** collection logs each delivery's status, response code, response body (2 KB) and errors; entries older than `outbound.deliveryRetentionDays` (default 30) are pruned.
- Secrets are encrypted at rest with a key derived from `PAYLOAD_SECRET` and masked when read.
- Postgres / SQLite projects need a migration for the new collections and `payload-jobs`.
- Disable with `outbound: false`.
