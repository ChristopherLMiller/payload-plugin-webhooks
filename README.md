# Payload Plugin Webhooks

A real-time webhook event streaming plugin for [Payload CMS](https://payloadcms.com) v3.

This plugin provides Server-Sent Events (SSE) based streaming of CRUD operations across your Payload collections, allowing clients to receive real-time updates when documents are created, updated, deleted, or read.

## Features

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
     * @default () => true - Anyone can read
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

## Managing Webhook Configuration

Once the plugin is installed, a **Webhooks** global will appear in your Payload admin panel.

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

## Connecting to the Webhook Stream

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
type WebhookPayload = {
  action: 'create' | 'delete' | 'read' | 'update'
  collection: string
  data?: unknown // The document data
  id?: number | string // The document ID
  previousData?: unknown // Previous data (for update operations only)
  timestamp: string // ISO 8601 timestamp
}
```

## Security

### Default Security

- **Stream Authentication**: By default, only requests authenticated by the host app (session, JWT, Payload API keys, Better Auth) can connect
- **Configuration Access**: By default, only authenticated users can modify webhook configuration
- **Read Access**: By default, anyone can read webhook configuration (useful for debugging)

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

3. **Event Emitter**: Events are broadcast using a singleton EventEmitter that maintains the stream of webhook events.

4. **SSE Endpoint**: The `/api/webhooks/stream` endpoint uses Server-Sent Events to push webhook events to connected clients in real-time.

5. **Authentication**: By default, the stream endpoint accepts any request authenticated by the host app (`req.user` or `payload.auth()`). Override with `streamAuth` if needed.

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
