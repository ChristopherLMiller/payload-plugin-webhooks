import type { PayloadRequest } from 'payload'

import { queueWebhookEvent } from './transactionQueue.js'
import { shouldEmitWebhook } from './webhookConfig.js'
import { type CRUDAction } from './webhookEventEmitter.js'

/**
 * `req.context` flag set on the plugin's own reads so they don't trigger more events.
 */
export const SKIP_WEBHOOKS_CONTEXT_KEY = 'payloadPluginWebhooksSkip'

export const emitWebhookEvent = async ({
  id,
  action,
  collectionSlug,
  doc,
  previousDoc,
  req,
}: {
  action: CRUDAction
  collectionSlug: string
  doc?: Record<string, unknown>
  id?: number | string
  previousDoc?: Record<string, unknown>
  req: PayloadRequest
}): Promise<void> => {
  if (req.context?.[SKIP_WEBHOOKS_CONTEXT_KEY]) {
    return
  }

  // Check if webhook should be emitted based on global config
  const shouldEmit = await shouldEmitWebhook(req.payload, collectionSlug, action)

  if (!shouldEmit) {
    return
  }

  await queueWebhookEvent(req, {
    id,
    action,
    collection: collectionSlug,
    doc,
    previousDoc,
    timestamp: new Date().toISOString(),
  })
}
