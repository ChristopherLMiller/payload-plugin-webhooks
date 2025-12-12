import type { Payload } from 'payload'

type WebhookConfig = {
  collection: string
  enabled: boolean
  operations: {
    create: boolean
    delete: boolean
    read: boolean
    update: boolean
  }
}

type WebhooksGlobal = {
  collections?: WebhookConfig[]
}

let cachedConfig: null | WebhookConfig[] = null
let cacheTimestamp: number = 0
const CACHE_TTL = 5000 // 5 seconds

export const getWebhookConfig = async (payload: Payload): Promise<WebhookConfig[]> => {
  const now = Date.now()

  // Return cached config if still valid
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL) {
    return cachedConfig
  }

  try {
    const global = await payload.findGlobal({
      slug: 'webhooks',
    })

    const webhooksGlobal = global as WebhooksGlobal
    const config = webhooksGlobal?.collections || []

    // Cache the config
    cachedConfig = config
    cacheTimestamp = now

    return config
  } catch (_error) {
    // If global doesn't exist yet, return empty array (all disabled)
    return []
  }
}

export const shouldEmitWebhook = async (
  payload: Payload,
  collectionSlug: string,
  operation: 'create' | 'delete' | 'read' | 'update',
): Promise<boolean> => {
  try {
    const config = await getWebhookConfig(payload)
    const collectionConfig = config.find((c) => c.collection === collectionSlug)

    // If no config found for this collection, don't emit (must be explicitly enabled)
    if (!collectionConfig) {
      return false
    }

    // Check if collection is enabled
    if (!collectionConfig.enabled) {
      return false
    }

    // Check if the specific operation is enabled
    return collectionConfig.operations[operation] === true
  } catch (_error) {
    // If there's an error reading the config, don't emit webhooks
    // Silently fail - webhooks will not be emitted if config cannot be read
    return false
  }
}
