import type { Access, CollectionConfig, Config, GlobalConfig } from 'payload'

import type { StreamAuth } from './auth/defaultStreamAuth.js'

import { createWebhookStreamHandler } from './endpoints/webhookStream.js'
import { WebhooksGlobal } from './globals/webhooks.js'
import { installTransactionHooks } from './hooks/transactionQueue.js'
import { invalidateWebhookConfigCache } from './hooks/webhookConfig.js'
import { emitWebhookEvent } from './hooks/webhookHandler.js'
import { WEBHOOKS_QUEUE } from './outbound/constants.js'
import { createDeliveriesCollection } from './outbound/deliveriesCollection.js'
import { createDeliverTask } from './outbound/deliverTask.js'
import { createEndpointsCollection } from './outbound/endpointsCollection.js'
import { enqueueDeliveries } from './outbound/enqueueDeliveries.js'

export type { StreamAuth } from './auth/defaultStreamAuth.js'
export type { WebhookPayload } from './hooks/webhookEventEmitter.js'
export {
  DELIVERIES_SLUG,
  DELIVERY_HEADER,
  ENDPOINTS_SLUG,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  WEBHOOKS_QUEUE,
} from './outbound/constants.js'
export { signBody } from './outbound/deliverTask.js'

export type OutboundWebhooksConfig = {
  /**
   * Who can manage webhook endpoints and view the delivery log.
   * @default ({ req }) => !!req.user - Only authenticated users
   */
  access?: Access
  /**
   * Who may set an endpoint's "Run as" user to someone other than themselves.
   * Everyone else can only run endpoints as themselves. Local API writes are always allowed.
   * @default () => false
   */
  assignRunAs?: Access
  /**
   * Run queued deliveries (retries) on a schedule in this process. Pass a cron string to
   * change the schedule, or `false` on serverless hosts and call
   * `/api/payload-jobs/run?queue=webhooks` from an external cron instead.
   * The first attempt is always made right after the change commits.
   * @default '* * * * *' (every minute)
   */
  autoRun?: boolean | string
  /**
   * Delete delivery log entries older than this many days. `0` keeps them forever.
   * @default 30
   */
  deliveryRetentionDays?: number
  /**
   * Retry attempts after a failed delivery, with exponential backoff starting at 30s.
   * @default 5
   */
  retries?: number
}

export type PayloadPluginWebhooksConfig = {
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
   */
  disabled?: boolean
  /**
   * Outbound webhooks: HTTP requests sent to other services when documents change,
   * configured in the "Webhook Endpoints" collection. Pass `false` to disable.
   * @default {}
   */
  outbound?: false | OutboundWebhooksConfig
  /**
   * Custom authentication check for the webhook stream endpoint.
   * If omitted, the stream accepts any request already authenticated by the host app:
   * session cookies, JWT, Payload native API keys (`auth.useAPIKey`), Better Auth,
   * and any other registered auth strategies.
   *
   * Regardless of this check, each subscriber only receives events for documents and
   * fields their user can read.
   */
  streamAuth?: StreamAuth
}

type Hooks = NonNullable<CollectionConfig['hooks']>

const toArray = <T>(value: T | T[] | undefined): T[] =>
  Array.isArray(value) ? value : value ? [value] : []

const getSingularLabel = (col: CollectionConfig): string => {
  const singular = col.labels?.singular
  if (typeof singular === 'string') {
    return singular
  }
  if (singular && typeof singular === 'object') {
    return singular.en || singular[''] || col.slug
  }
  return col.slug.charAt(0).toUpperCase() + col.slug.slice(1)
}

const isAuthenticated: Access = ({ req }) => !!req.user

export const payloadPluginWebhooks =
  (pluginOptions: PayloadPluginWebhooksConfig = {}) =>
  (config: Config): Config => {
    /**
     * If the plugin is disabled, return config without modifications
     */
    if (pluginOptions.disabled) {
      return config
    }

    const outbound = pluginOptions.outbound === false ? null : (pluginOptions.outbound ?? {})

    // The admin user collection is not offered as a webhook source; it is the "Run as" target.
    const adminUserSlug =
      config.admin?.user ?? config.collections?.find((col) => col.auth)?.slug ?? 'users'
    const availableCollections = (config.collections ?? [])
      .filter((col) => col.slug !== adminUserSlug)
      .map((col) => ({ label: getSingularLabel(col), value: col.slug }))

    // Add webhook hooks to all collections for CRUD operations
    for (const collection of config.collections ?? []) {
      const hooks: Hooks = collection.hooks ?? {}
      collection.hooks = hooks

      hooks.afterChange = [
        ...toArray(hooks.afterChange),
        async ({ doc, operation, previousDoc, req }) => {
          const action = operation === 'create' ? 'create' : 'update'
          const previous = action === 'create' ? undefined : previousDoc || undefined
          await emitWebhookEvent({
            id: doc.id,
            action,
            collectionSlug: collection.slug,
            doc,
            previousDoc: previous,
            req,
          })
          if (outbound) {
            await enqueueDeliveries({
              event: {
                id: doc.id,
                action,
                collection: collection.slug,
                doc,
                previousDoc: previous,
                timestamp: new Date().toISOString(),
              },
              req,
              runAsCollection: adminUserSlug,
            })
          }
        },
      ]

      hooks.afterDelete = [
        ...toArray(hooks.afterDelete),
        async ({ id, doc, req }) => {
          await emitWebhookEvent({
            id: doc?.id ?? id,
            action: 'delete',
            collectionSlug: collection.slug,
            doc,
            req,
          })
          if (outbound) {
            await enqueueDeliveries({
              event: {
                id: doc?.id ?? id,
                action: 'delete',
                collection: collection.slug,
                timestamp: new Date().toISOString(),
              },
              req,
              runAsCollection: adminUserSlug,
            })
          }
        },
      ]

      hooks.afterRead = [
        ...toArray(hooks.afterRead),
        async ({ doc, req }) => {
          await emitWebhookEvent({
            id: doc.id,
            action: 'read',
            collectionSlug: collection.slug,
            doc,
            req,
          })
          return doc
        },
      ]
    }

    const webhooksGlobal: GlobalConfig = {
      ...WebhooksGlobal,
      access: {
        read: pluginOptions.access?.read || isAuthenticated,
        update: pluginOptions.access?.update || isAuthenticated,
      },
      fields: WebhooksGlobal.fields.map((field) => {
        if (!('name' in field) || field.name !== 'collections' || field.type !== 'array') {
          return field
        }
        return {
          ...field,
          fields: field.fields.map((arrayField) =>
            'name' in arrayField && arrayField.name === 'collection' && arrayField.type === 'select'
              ? { ...arrayField, options: availableCollections }
              : arrayField,
          ),
        }
      }),
      hooks: {
        ...WebhooksGlobal.hooks,
        afterChange: [
          ...toArray(WebhooksGlobal.hooks?.afterChange),
          () => {
            invalidateWebhookConfigCache()
          },
        ],
      },
    }

    config.globals = [...(config.globals ?? []), webhooksGlobal]

    // Add webhook stream endpoint for clients to listen to CRUD events
    config.endpoints = [
      ...(config.endpoints ?? []),
      {
        handler: createWebhookStreamHandler(pluginOptions.streamAuth),
        method: 'get',
        path: '/webhooks/stream',
      },
    ]

    if (outbound) {
      const manage = outbound.access ?? isAuthenticated
      config.collections = [
        ...(config.collections ?? []),
        createEndpointsCollection({
          access: manage,
          assignRunAs: outbound.assignRunAs ?? (() => false),
          collectionOptions: availableCollections,
          runAsCollection: adminUserSlug,
        }),
        createDeliveriesCollection({ access: manage }),
      ]

      const autoRun = outbound.autoRun ?? true
      const cron = typeof autoRun === 'string' ? autoRun : '* * * * *'
      const existingAutoRun = config.jobs?.autoRun
      const ownAutoRun = autoRun ? [{ cron, limit: 10, queue: WEBHOOKS_QUEUE }] : []

      config.jobs = {
        ...config.jobs,
        autoRun:
          typeof existingAutoRun === 'function'
            ? async (payload) => [...(await existingAutoRun(payload)), ...ownAutoRun]
            : [...(existingAutoRun ?? []), ...ownAutoRun],
        tasks: [
          ...(config.jobs?.tasks ?? []),
          createDeliverTask({
            retainDays: outbound.deliveryRetentionDays ?? 30,
            retries: outbound.retries ?? 5,
          }),
        ],
      }
    }

    // Hold events raised inside a transaction until it commits. Installed before the host
    // app's own onInit so seed scripts and other startup writes are covered too.
    const existingOnInit = config.onInit
    config.onInit = async (payload) => {
      installTransactionHooks(payload)
      await existingOnInit?.(payload)
    }

    return config
  }
