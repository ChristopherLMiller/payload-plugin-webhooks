# payload-plugin-webhooks

## 1.2.0

### Minor Changes

- Remove the plugin-owned API keys collection. The webhook stream now authenticates through the host app (session, JWT, Payload native API keys, Better Auth, and other registered strategies).
