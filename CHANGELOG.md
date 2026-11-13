# payload-plugin-webhooks

## 1.3.0

### Minor Changes

- 889b028: Add outbound webhooks: HTTP requests sent to other services when documents change.

  - New **Webhook Endpoints** collection: URL, method, which collections and operations trigger it, authentication (none, Bearer, Basic, custom header), optional HMAC signing secret, extra headers, timeout, and whether to include the document.
  - Documents are read as each endpoint's **Run as** user, so receivers only get what that user may read. Users can only run endpoints as themselves unless `outbound.assignRunAs` allows otherwise.
  - Delivery uses Payload's jobs queue (`webhooks` queue): queued in the same transaction as the change, started right after commit, retried with exponential backoff (`outbound.retries`, default 5). Retries run in-process every minute by default (`outbound.autoRun`); set it to `false` on serverless and call `/api/payload-jobs/run?queue=webhooks` instead.
  - New **Webhook Deliveries** collection logs each delivery's status, response code, response body (2 KB) and errors; entries older than `outbound.deliveryRetentionDays` (default 30) are pruned.
  - Secrets are encrypted at rest with a key derived from `PAYLOAD_SECRET` and masked when read.
  - Postgres / SQLite projects need a migration for the new collections and `payload-jobs`.
  - Disable with `outbound: false`.
  - The admin panel explains itself: a setup guide with per-site instructions (Home Assistant, Zapier, Make, n8n, IFTTT, custom APIs), a live preview of the request, a **Send test request** button (`POST /api/webhook-endpoints/:id/test`), a per-endpoint **Delivery log** tab, and plain-language hints on failures.
  - The stream settings global is now labelled **Event Stream** (slug unchanged) and explains how it differs from endpoints.

- e51119a: Security and reliability fixes for the webhook stream.

  - Events are now filtered per subscriber through Payload access control. Documents are re-read as the subscribing user, so collection access (including query-based access), field-level access, and hidden fields are respected. Previously every authenticated subscriber received full documents from every enabled collection.
  - `previousData` is reduced to the fields visible in the subscriber's `data`.
  - **Behavior change:** delete events now contain only `id` (no `data`), and are sent only to subscribers with read access to the collection.
  - Events are held until the database transaction commits, and dropped on rollback.
  - **Behavior change:** the webhooks global is no longer publicly readable by default; it now requires an authenticated user. Pass `access.read` to restore the old behavior.
  - Saving the webhooks global takes effect immediately instead of after the 5-second cache window.
  - Fixed `MaxListenersExceededWarning` once more than 10 clients are connected.
  - The collection excluded from the webhook options now follows `admin.user` instead of the hardcoded `users` slug.
  - `WebhookPayload` type is now exported.

## 1.2.0

### Minor Changes

- Remove the plugin-owned API keys collection. The webhook stream now authenticates through the host app (session, JWT, Payload native API keys, Better Auth, and other registered strategies).
