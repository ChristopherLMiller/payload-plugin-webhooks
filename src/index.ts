import type { Access, CollectionConfig, Config, GlobalConfig } from 'payload'

import type { StreamAuth } from './auth/defaultStreamAuth.js'

import { createWebhookStreamHandler } from './endpoints/webhookStream.js'
import { WebhooksGlobal } from './globals/webhooks.js'
import { installTransactionHooks } from './hooks/transactionQueue.js'
import { invalidateWebhookConfigCache } from './hooks/webhookConfig.js'
import { emitWebhookEvent } from './hooks/webhookHandler.js'

export type { StreamAuth } from './auth/defaultStreamAuth.js'
export type { WebhookPayload } from './hooks/webhookEventEmitter.js'

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

    // Add webhook hooks to all collections for CRUD operations
    for (const collection of config.collections ?? []) {
      const hooks: Hooks = collection.hooks ?? {}
      collection.hooks = hooks

      hooks.afterChange = [
        ...toArray(hooks.afterChange),
        async ({ doc, operation, previousDoc, req }) => {
          await emitWebhookEvent({
            id: doc.id,
            action: operation === 'create' ? 'create' : 'update',
            collectionSlug: collection.slug,
            doc,
            previousDoc: operation === 'create' ? undefined : previousDoc || undefined,
            req,
          })
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

    // The admin user collection is not offered as a webhook source.
    const adminUserSlug = config.admin?.user ?? 'users'
    const availableCollections = (config.collections ?? [])
      .filter((col) => col.slug !== adminUserSlug)
      .map((col) => ({ label: getSingularLabel(col), value: col.slug }))

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

    // Hold events raised inside a transaction until it commits. Installed before the host
    // app's own onInit so seed scripts and other startup writes are covered too.
    const existingOnInit = config.onInit
    config.onInit = async (payload) => {
      installTransactionHooks(payload)
      await existingOnInit?.(payload)
    }

    return config
  }
