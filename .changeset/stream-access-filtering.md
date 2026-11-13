---
'payload-plugin-webhooks': minor
---

Security and reliability fixes for the webhook stream.

- Events are now filtered per subscriber through Payload access control. Documents are re-read as the subscribing user, so collection access (including query-based access), field-level access, and hidden fields are respected. Previously every authenticated subscriber received full documents from every enabled collection.
- `previousData` is reduced to the fields visible in the subscriber's `data`.
- **Behavior change:** delete events now contain only `id` (no `data`), and are sent only to subscribers with read access to the collection.
- Events are held until the database transaction commits, and dropped on rollback.
- **Behavior change:** the webhooks global is no longer publicly readable by default; it now requires an authenticated user. Pass `access.read` to restore the old behavior.
- Saving the webhooks global takes effect immediately instead of after the 5-second cache window.
- Fixed `MaxListenersExceededWarning` once more than 10 clients are connected.
- The collection excluded from the webhook options now follows `admin.user` instead of the hardcoded `users` slug.
- `WebhookPayload` type is now exported.
