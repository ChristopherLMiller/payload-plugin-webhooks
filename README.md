# Payload Plugin Webhooks

A real-time webhook event streaming plugin for [Payload CMS](https://payloadcms.com) v3.

This plugin provides Server-Sent Events (SSE) based streaming of CRUD operations across your Payload collections, allowing clients to receive real-time updates when documents are created, updated, deleted, or read.

## Features

- 🔄 Real-time SSE streaming of CRUD operations
- 🔐 Built-in authentication for stream connections
- 🔑 API Keys collection for managing webhook stream access
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
type PayloadPluginWebhooksConfig = {
  /**
   * Disable the plugin
   * @default false
   */
  disabled?: boolean

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
   * Custom authentication check for the webhook stream endpoint
   * If provided, this function will be called to determine if a user can connect to the stream
   * If not provided, defaults to requiring an authenticated user (req.user exists)
   * @param req - The Payload request object
   * @returns true to allow access, false to deny with 401
   */
  streamAuth?: (req: any) => boolean | Promise<boolean>
}
```

### Example: Basic Configuration

```ts
import { payloadPluginWebhooks } from 'payload-plugin-webhooks'

export default buildConfig({
  plugins: [
    payloadPluginWebhooks({
      // Use default authentication (requires logged-in user)
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

### Example: API Key Authentication

```ts
import { payloadPluginWebhooks } from 'payload-plugin-webhooks'

export default buildConfig({
  plugins: [
    payloadPluginWebhooks({
      // Validate API keys from the api-keys collection
      streamAuth: async (req) => {
        const apiKey = req.headers.get('x-api-key')

        if (!apiKey) {
          return false
        }

        try {
          // Query the api-keys collection for a matching active key
          const result = await req.payload.find({
            collection: 'api-keys',
            where: {
              key: { equals: apiKey },
              active: { equals: true }
            },
            limit: 1
          })

          // If found, update lastUsed and grant access
          if (result.docs.length > 0) {
            await req.payload.update({
              collection: 'api-keys',
              id: result.docs[0].id,
              data: { lastUsed: new Date().toISOString() }
            })
            return true
          }

          return false
        } catch (error) {
          console.error('Error validating API key:', error)
          return false
        }
      },
    }),
  ],
})
```

## Managing Webhook Configuration

Once the plugin is installed, a new **Webhooks** group will appear in your Payload admin panel containing:
- **Webhooks** global configuration
- **API Keys** collection for managing stream access

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

### Managing API Keys

The plugin includes an **API Keys** collection for managing webhook stream authentication:

1. Navigate to **Collections** → **API Keys** in the admin panel
2. Create a new API key:
   - Select the user this key belongs to (defaults to current user)
   - Click **Generate Key** to create a strong random API key
   - Click **Copy to Clipboard** to copy the key
   - Use the eye icon to show/hide the key value
3. Each user can only have one API key at a time
4. Keys can be temporarily disabled using the **Active** checkbox
5. The **Last Used** timestamp tracks when the key was last used

**Security Features:**
- Keys are obfuscated in list view (shown as •••••••••••••••••)
- Keys are hidden by default in edit view with a show/hide toggle
- Strong 256-bit randomly generated keys
- One key per user restriction
- Active/inactive status control
- Usage tracking with lastUsed timestamp

## Connecting to the Webhook Stream

The plugin exposes a Server-Sent Events (SSE) endpoint at `/api/webhooks/stream`.

### Authentication

**By default, the stream endpoint requires an authenticated user.** You must include authentication credentials (session cookie or JWT token) when connecting to the stream.

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

### Client Example (with API Key)

If you've configured custom `streamAuth` to accept API keys:

```ts
// Using fetch to add custom headers
const response = await fetch('/api/webhooks/stream', {
  headers: {
    'X-API-Key': 'your-api-key',
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

- **Stream Authentication**: By default, only authenticated users can connect to the webhook stream
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

5. **Authentication**: By default, the stream endpoint checks for `req.user` to ensure only authenticated users can connect. This can be customized via the `streamAuth` option.

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
