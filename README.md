# Payload Plugin Webhooks

Webhooks for [Payload CMS](https://payloadcms.com) v3, in two forms:

- **Outbound webhooks**: send an HTTP request to another service (Home Assistant, Zapier, your own API, …) when documents are created, updated or deleted. Configured in the admin panel, delivered in the background with retries, and logged.
- **Event stream**: a Server-Sent Events (SSE) endpoint that clients connect to for real-time CRUD events.

## Features

- 📤 Outbound webhooks with per-endpoint URL, events, authentication, signing and headers
- 🔁 Background delivery with retries and a delivery log
- 🔄 Real-time SSE streaming of CRUD operations
- 🔐 Stream auth via the host app (session, JWT, Payload API keys, Better Auth)
- 🎛️ Configurable access control for webhook management
- ⚙️ Per-collection and per-operation event configuration
- 🔌 Easy integration with existing Payload projects
- 🛡️ Secure by default with customizable authentication

## Installation

```bash
npm install payload-plugin-webhooks
# or
yarn add payload-plugin-webhooks
# or
pnpm add payload-plugin-webhooks
```

## Basic Usage

Add the plugin to your `payload.config.ts`:

```ts
import { payloadPluginWebhooks } from 'payload-plugin-webhooks'

export default buildConfig({
  plugins: [
    payloadPluginWebhooks({
      // Plugin options
    }),
  ],
})
```

## Outbound Webhooks

Once the plugin is installed, the admin panel gets a **Webhooks** group with:

- **Webhook Endpoints**: where you add each URL to call.
- **Webhook Deliveries**: a log of every request: status, response code, response body (first 2 KB), attempts and errors.

### Adding an endpoint

| Field | What it does |
| --- | --- |
| **Name** | Your own label. |
| **Method / URL** | The request to make. `POST` by default. |
| **Events → Collections / Operations** | Which collections, and which of create / update / delete, trigger this endpoint. |
| **Run as** | The user whose access is used to read the document before sending it. The receiving service only gets what this user may read. Defaults to you; see [Run as](#run-as). |
| **Include document** | Send the document (and previous version, for updates). Off sends only collection, action and id. |
| **Authentication** | None, Bearer token, Basic (username/password) or a custom header. Secrets are encrypted at rest and shown masked after saving. |
| **Signing secret** | Optional HMAC signature header, see [Verifying requests](#verifying-requests). |
| **Additional headers** | Extra, non-secret headers. |
| **Timeout** | Seconds to wait for a response (default 10). |

### Request format

```http
POST /your/url
Content-Type: application/json
User-Agent: payload-plugin-webhooks
X-Webhook-Event: posts.update
X-Webhook-Delivery: 6650c1…           # unique per delivery; use it to ignore duplicates
X-Webhook-Signature: t=1731500000,v1=… # only with a signing secret

{
  "event": "posts.update",
  "action": "update",
  "collection": "posts",
  "id": "6650b9…",
  "timestamp": "2026-11-13T12:00:00.000Z",
  "deliveryId": "6650c1…",
  "data": { "...": "the document, as the Run as user can read it" },
  "previousData": { "...": "previous version, same visible fields (updates only)" }
}
```

Delete events contain no `data`: the document is gone, so it can't be read with the Run as user's access. They are only sent if that user has read access to the collection.

### Example: Home Assistant

1. In Home Assistant, create an automation with a **Webhook** trigger and note its webhook ID. If Payload is not on the same network as Home Assistant, turn off **Only accessible from the local network** on the trigger, or Home Assistant will ignore the request.
2. In Payload, add a Webhook Endpoint:
   - **URL**: `https://<your-home-assistant>/api/webhook/<webhook_id>`
   - **Authentication**: None (the webhook ID is the secret, so keep the URL private)
   - **Events**: the collections and operations you care about
3. In the automation, the request body is available as `trigger.json`, e.g. `{{ trigger.json.data.title }}` or a condition on `{{ trigger.json.event == 'posts.create' }}`.

To call Home Assistant's REST API instead (e.g. `/api/services/notify/...`), use **Bearer token** with a long-lived access token.

### Delivery and retries

- Deliveries are recorded in the same database transaction as the change, so a change that rolls back never sends a request.
- The first attempt starts right after the change commits, in the background. Saving a document never waits for the remote service.
- Any non-2xx response, timeout, or network error is a failure. Redirects are not followed (credentials are not sent to another host); a 3xx is logged as a failure telling you to update the URL.
- Failures are retried with exponential backoff starting at 30s (5 retries by default) using [Payload's jobs queue](https://payloadcms.com/docs/jobs-queue/overview) on the `webhooks` queue.
- Retries are run by a cron in the Payload process (`autoRun`, every minute by default). **On serverless hosts** set `outbound: { autoRun: false }` and call `GET /api/payload-jobs/run?queue=webhooks` from an external scheduler instead.
- A delivery can, rarely, be sent more than once (for example if the process stops right after the request). Use the `X-Webhook-Delivery` header to deduplicate if that matters.
- The plugin adds Payload's `payload-jobs` collection and two collections of its own. **Postgres / SQLite users: create and run a migration** after upgrading.

### Verifying requests

With a signing secret, `X-Webhook-Signature` is `t=<unix seconds>,v1=<hex>`, where `v1` is the HMAC-SHA256 of `"<t>.<raw request body>"`. Verify it against the raw body, and reject old timestamps to prevent replays:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export const verify = (rawBody: string, header: string, secret: string, toleranceSec = 300) => {
  const t = Number(/t=(\d+)/.exec(header)?.[1])
  const v1 = /v1=([a-f0-9]+)/.exec(header)?.[1] ?? ''
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected))
}
```

`signBody(secret, t, rawBody)` is also exported from `payload-plugin-webhooks` if the receiver is Node.

### Run as

Every endpoint reads documents as its **Run as** user, with `overrideAccess: false`, so collection access, query-based access, field-level access and hidden fields all apply. For external services, create a dedicated user that can only read what the service needs.

Users can only set **Run as** to themselves, so someone with limited access can't create an endpoint that receives documents they can't read. To let administrators pick any user:

```ts
payloadPluginWebhooks({
  outbound: {
    assignRunAs: ({ req }) => req.user?.role === 'admin',
  },
})
```

### Secrets

Tokens, passwords, header values and signing secrets are encrypted with AES-256-GCM using a key derived from `PAYLOAD_SECRET`, and read back as `••••••••`. **If you change `PAYLOAD_SECRET`, re-enter them.**

## Configuration

### Plugin Options

```ts
import type { Access } from 'payload'
import type { StreamAuth } from 'payload-plugin-webhooks'

type PayloadPluginWebhooksConfig = {
  /**
   * Access control for the webhooks global configuration
   */
  access?: {
    /**
     * Control who can read webhook configuration
     * @default ({ req }) => !!req.user - Only authenticated users
     */
    read?: Access

    /**
     * Control who can create/update webhook configuration
     * @default ({ req }) => !!req.user - Only authenticated users
     */
    update?: Access
  }

  /**
   * Disable the plugin
   * @default false
   */
  disabled?: boolean

  /**
   * Outbound webhooks. Pass `false` to disable them (and their collections).
   */
  outbound?:
    | false
    | {
        /** Who can manage endpoints and view deliveries. @default ({ req }) => !!req.user */
        access?: Access
        /** Who may set "Run as" to someone other than themselves. @default () => false */
        assignRunAs?: Access
        /** Cron for retries in-process, or false on serverless. @default '* * * * *' */
        autoRun?: boolean | string
        /** Delete delivery log entries older than this. 0 = keep forever. @default 30 */
        deliveryRetentionDays?: number
        /** Retry attempts after a failure (exponential backoff from 30s). @default 5 */
        retries?: number
      }

  /**
   * Custom authentication check for the webhook stream endpoint.
   * If omitted, the stream accepts any request already authenticated by the host app
   * (session cookies, JWT, Payload native API keys, Better Auth, custom strategies).
   */
  streamAuth?: StreamAuth
}
```

### Example: Basic Configuration

```ts
import { payloadPluginWebhooks } from 'payload-plugin-webhooks'

export default buildConfig({
  plugins: [
    payloadPluginWebhooks({
      // Use host-app auth (session, JWT, Payload API keys, Better Auth)
    }),
  ],
})
```

### Example: Custom Access Control

```ts
import { payloadPluginWebhooks } from 'payload-plugin-webhooks'

export default buildConfig({
  plugins: [
    payloadPluginWebhooks({
      access: {
        // Only admins can read webhook configuration
        read: ({ req }) => req.user?.role === 'admin',
        // Only superadmins can update webhook configuration
        update: ({ req }) => req.user?.role === 'superadmin',
      },
    }),
  ],
})
```

### Stream authentication

This plugin does **not** ship its own API key collection. The stream uses whatever auth the host Payload app already has.

If `req.user` is already set, the connection is allowed. Otherwise the plugin calls `payload.auth()`, which runs every registered strategy:

| Method | How to send it |
| --- | --- |
| Session cookie | `EventSource(..., { withCredentials: true })` |
| JWT | `Authorization: JWT <token>` |
| Payload native API key | `Authorization: users API-Key <key>` |
| Better Auth API key | `x-api-key: <key>` or `Authorization: Bearer <key>` |

#### Payload native API keys

Enable Payload's built-in keys on an auth collection:

```ts
import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    useAPIKey: true,
  },
  fields: [],
}
```

Generate a key on the user in the admin UI, then send:

```http
Authorization: users API-Key <key>
```

#### Better Auth

If you use Better Auth (`@delmaredigital/payload-better-auth`, `payload-auth`, etc.), keep API keys in that plugin. When it registers a Payload auth strategy, a valid key populates `req.user` and the stream accepts it with no extra plugin config.

#### Custom `streamAuth`

Override only if you need a stricter check than "is this request authenticated?":

```ts
payloadPluginWebhooks({
  streamAuth: async (req) => req.user?.role === 'admin',
})
```

### Migrating from the plugin `api-keys` collection

v1.1.x added a plugin-owned `api-keys` collection. That store is gone. After upgrading:

1. Stop sending `X-API-Key` against that collection.
2. Enable Payload `auth.useAPIKey` on your users (or keep using Better Auth keys).
3. Drop the leftover `api-keys` collection from your database if it exists.

## Event Stream (SSE)

### Managing stream configuration

The **Webhooks** global (under the **Webhooks** group) controls which events the SSE stream sends. It does not affect outbound webhooks, which are configured per endpoint.

### Configuring Collections

1. Navigate to **Globals** → **Webhooks** in the admin panel
2. Add collections you want to monitor
3. For each collection, configure:
   - **Enabled**: Toggle to enable/disable webhooks for this collection
   - **Operations**: Select which CRUD operations should emit events:
     - **Create**: Emit events when documents are created
     - **Read**: Emit events when documents are read (disabled by default)
     - **Update**: Emit events when documents are updated
     - **Delete**: Emit events when documents are deleted

### Connecting to the Webhook Stream

The plugin exposes a Server-Sent Events (SSE) endpoint at `/api/webhooks/stream`.

### Authentication

The stream endpoint requires an authenticated request. Browser clients can send the session cookie; machine clients can send a JWT or API key header.

### Client Example (JavaScript)

```ts
// Connect to the webhook stream with authentication
const eventSource = new EventSource('/api/webhooks/stream', {
  withCredentials: true, // Include cookies for session authentication
})

// Listen for webhook events
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)

  if (data.type === 'connected') {
    console.log('Connected to webhook stream')
    return
  }

  // Handle webhook events
  console.log('Webhook event:', data)
  // {
  //   action: 'create' | 'update' | 'delete' | 'read',
  //   collection: 'posts',
  //   data: { ... },
  //   id: '123',
  //   timestamp: '2024-01-01T00:00:00.000Z'
  // }
})

eventSource.addEventListener('error', (error) => {
  console.error('Stream error:', error)
})
```

### Client Example (API key)

`EventSource` cannot set custom headers. Use `fetch` for Payload native keys or Better Auth keys:

```ts
const response = await fetch('/api/webhooks/stream', {
  headers: {
    // Payload native API keys:
    Authorization: 'users API-Key your-api-key',
    // Better Auth (if that plugin's strategy is registered):
    // 'x-api-key': 'your-api-key',
  },
})

const reader = response.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  const chunk = decoder.decode(value)
  const lines = chunk.split('\n')

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6))
      console.log('Webhook event:', data)
    }
  }
}
```

## Webhook Event Structure

All webhook events follow this structure:

```ts
import type { WebhookPayload } from 'payload-plugin-webhooks'

type WebhookPayload = {
  action: 'create' | 'delete' | 'read' | 'update'
  collection: string
  data?: unknown // The document, as the subscriber is allowed to read it (not sent for delete)
  id?: number | string // The document ID
  previousData?: unknown // Previous version (update only), limited to fields visible in `data`
  timestamp: string // ISO 8601 timestamp
}
```

### What each subscriber receives

Events are filtered **per subscriber**, using that subscriber's own Payload access control:

- **create / update / read**: the document is re-read as the subscriber (`overrideAccess: false`, `depth: 0`). If the subscriber cannot read the document (collection access, including query-based access like `{ status: { equals: 'published' } }`), the event is not sent. Fields hidden by field-level access or `hidden: true` are removed from `data`, and `previousData` is reduced to the same visible fields.
- **delete**: the document no longer exists, so it cannot be re-read. Delete events contain only `id`, and are sent only to subscribers whose collection read access is not `false`.

Each event costs one database read per distinct subscribing user.

### Delivery timing

Events raised inside a database transaction are held until it **commits**, and dropped if it rolls back. Subscribers will not see changes that never happened, and a document from an event can be fetched immediately.

## Security

### Default Security

- **Stream Authentication**: By default, only requests authenticated by the host app (session, JWT, Payload API keys, Better Auth) can connect
- **Event Filtering**: Subscribers only receive documents and fields their user can read (see [What each subscriber receives](#what-each-subscriber-receives))
- **Configuration Access**: By default, only authenticated users can read or modify webhook configuration

### Customizing Security

You can customize security using the plugin options:

```ts
payloadPluginWebhooks({
  // Customize who can read/update webhook configuration
  access: {
    read: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'superadmin',
  },

  // Customize stream authentication
  streamAuth: async (req) => {
    // Your custom authentication logic
    return true // or false
  },
})
```

## Development

To develop and test this plugin locally:

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build the plugin
pnpm build

# Run tests
pnpm test
```

The `dev` folder contains a test Payload project where you can develop and test the plugin.

## How It Works

1. **Global Configuration**: The plugin adds a `webhooks` global to your Payload config where you can configure which collections and operations should emit webhook events.

2. **Hooks Integration**: The plugin automatically adds `afterChange`, `afterDelete`, and `afterRead` hooks to all your collections to emit webhook events.

3. **Commit-aware queue**: Events raised inside a transaction are held until the database adapter commits it (and discarded on rollback).

4. **Event Emitter**: Committed events are broadcast in-process using a singleton EventEmitter.

5. **SSE Endpoint**: The `/api/webhooks/stream` endpoint uses Server-Sent Events to push events to connected clients, filtered through each subscriber's read access.

6. **Authentication**: By default, the stream endpoint accepts any request authenticated by the host app (`req.user` or `payload.auth()`). Override with `streamAuth` if needed.

### Limitations

- **Single process**: events are broadcast in memory. If you run several Payload instances, a client only receives events from changes handled by the instance it is connected to.
- **Long-lived connections**: serverless platforms that cap request duration will close the stream. Clients should reconnect (`EventSource` does this automatically).
- **No replay**: events that happen while a client is disconnected are not redelivered.

## Use Cases

- **Real-time dashboards**: Update dashboards in real-time when data changes
- **Audit logging**: Track all CRUD operations across your collections
- **Synchronization**: Keep external systems in sync with Payload data
- **Notifications**: Trigger notifications when specific events occur
- **Analytics**: Monitor user activity and data changes in real-time

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Workflow

This project uses [Changesets](https://github.com/changesets/changesets) for version management and changelog generation.

When making changes:

1. Make your changes
2. Create a changeset:
   ```bash
   pnpm changeset
   ```
3. Follow the prompts to describe your changes
4. Commit the changeset file along with your changes

### Releasing

To release a new version:

1. Update versions and generate changelog:
   ```bash
   pnpm version
   ```
2. Review the changes and commit
3. Publish to npm:
   ```bash
   pnpm release
   ```
