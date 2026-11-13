---
'payload-plugin-webhooks': patch
---

Fix "Send test" returning 400 ("The following field is invalid: Endpoint") on databases with numeric ids (Postgres, SQLite). The test delivery now links to the endpoint using the loaded document's id instead of the string route param.
