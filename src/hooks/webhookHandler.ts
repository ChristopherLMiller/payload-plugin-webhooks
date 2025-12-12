import type { CollectionConfig, Payload } from 'payload'

import { shouldEmitWebhook } from './webhookConfig.js'
import { webhookEventEmitter, type WebhookPayload } from './webhookEventEmitter.js'

type CRUDAction = 'create' | 'delete' | 'read' | 'update'

export const emitWebhookEvent = async (
  action: CRUDAction,
  collection: CollectionConfig,
  payload: Payload,
  data?: unknown,
  previousData?: unknown,
  id?: number | string,
): Promise<void> => {
  // Check if webhook should be emitted based on global config
  const shouldEmit = await shouldEmitWebhook(payload, collection.slug, action)

  if (!shouldEmit) {
    return
  }

  const webhookPayload: WebhookPayload = {
    id,
    action,
    collection: collection.slug,
    data,
    previousData,
    timestamp: new Date().toISOString(),
  }

  // Emit the webhook event to all connected clients
  webhookEventEmitter.emitWebhook(webhookPayload)
}
