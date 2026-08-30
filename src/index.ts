import type { Access, Config } from 'payload'

import type { StreamAuth } from './auth/defaultStreamAuth.js'

import { createWebhookStreamHandler } from './endpoints/webhookStream.js'
import { WebhooksGlobal } from './globals/webhooks.js'
import { emitWebhookEvent } from './hooks/webhookHandler.js'

export type { StreamAuth } from './auth/defaultStreamAuth.js'

export type PayloadPluginWebhooksConfig = {
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
   */
  disabled?: boolean
  /**
   * Custom authentication check for the webhook stream endpoint.
   * If omitted, the stream accepts any request already authenticated by the host app:
   * session cookies, JWT, Payload native API keys (`auth.useAPIKey`), Better Auth,
   * and any other registered auth strategies.
   */
  streamAuth?: StreamAuth
}

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
    if (config.collections) {
      for (const collection of config.collections) {
        // Store original hooks to preserve existing functionality
        const originalAfterChange = collection.hooks?.afterChange
        const originalAfterDelete = collection.hooks?.afterDelete
        const originalAfterRead = collection.hooks?.afterRead

        // Initialize hooks object if it doesn't exist
        if (!collection.hooks) {
          collection.hooks = {}
        }

        // Normalize hooks to arrays (Payload supports both function and array)
        const existingAfterChange = Array.isArray(originalAfterChange)
          ? originalAfterChange
          : originalAfterChange
            ? [originalAfterChange]
            : []
        const existingAfterDelete = Array.isArray(originalAfterDelete)
          ? originalAfterDelete
          : originalAfterDelete
            ? [originalAfterDelete]
            : []
        const existingAfterRead = Array.isArray(originalAfterRead)
          ? originalAfterRead
          : originalAfterRead
            ? [originalAfterRead]
            : []

        // Hook for create and update operations
        collection.hooks.afterChange = [
          ...existingAfterChange,
          async (args) => {
            const { doc, operation, previousDoc, req } = args

            const action = operation === 'create' ? 'create' : 'update'
            await emitWebhookEvent(
              action,
              collection,
              req.payload,
              doc,
              previousDoc || undefined,
              doc.id,
            )
          },
        ]

        // Hook for delete operations
        collection.hooks.afterDelete = [
          ...existingAfterDelete,
          async (args) => {
            const { doc, req } = args

            await emitWebhookEvent('delete', collection, req.payload, doc, undefined, doc.id)
          },
        ]

        // Hook for read operations
        collection.hooks.afterRead = [
          ...existingAfterRead,
          async (args) => {
            const { doc, req } = args

            await emitWebhookEvent('read', collection, req.payload, doc, undefined, doc.id)
          },
        ]
      }
    }

    // Add webhooks global
    if (!config.globals) {
      config.globals = []
    }

    // Populate collection select options dynamically and apply access control
    const webhooksGlobal = {
      ...WebhooksGlobal,
      access: {
        read: pluginOptions.access?.read || (() => true),
        update: pluginOptions.access?.update || (({ req }) => !!req.user),
      },
    }
    if (webhooksGlobal.fields && config.collections) {
      for (const field of webhooksGlobal.fields) {
        if (
          'name' in field &&
          field.name === 'collections' &&
          field.type === 'array' &&
          'fields' in field &&
          field.fields
        ) {
          for (const arrayField of field.fields) {
            if (
              'name' in arrayField &&
              arrayField.name === 'collection' &&
              arrayField.type === 'select' &&
              'options' in arrayField
            ) {
              const availableCollections = config.collections
                .filter((col) => col.slug !== 'users')
                .map((col) => {
                  const singularLabel =
                    typeof col.labels?.singular === 'string'
                      ? col.labels.singular
                      : typeof col.labels?.singular === 'object'
                        ? col.labels.singular.en || col.labels.singular[''] || col.slug
                        : col.slug.charAt(0).toUpperCase() + col.slug.slice(1)
                  return {
                    label: singularLabel,
                    value: col.slug,
                  }
                })
              arrayField.options = availableCollections
              break
            }
          }
          break
        }
      }
    }

    config.globals.push(webhooksGlobal)

    if (!config.endpoints) {
      config.endpoints = []
    }

    // Add webhook stream endpoint for clients to listen to CRUD events
    config.endpoints.push({
      handler: createWebhookStreamHandler(pluginOptions.streamAuth),
      method: 'get',
      path: '/webhooks/stream',
    })

    return config
  }
