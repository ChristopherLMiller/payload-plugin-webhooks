import { EventEmitter } from 'node:events'

export type CRUDAction = 'create' | 'delete' | 'read' | 'update'

/**
 * Shape sent to stream subscribers. `data` / `previousData` are filtered through the
 * subscriber's own read access before being sent.
 */
export type WebhookPayload = {
  action: CRUDAction
  collection: string
  data?: unknown
  id?: number | string
  previousData?: unknown
  timestamp: string
}

/**
 * Internal event carrying the raw, unfiltered documents. Never sent to clients as-is.
 */
export type WebhookEvent = {
  action: CRUDAction
  collection: string
  doc?: Record<string, unknown>
  id?: number | string
  previousDoc?: Record<string, unknown>
  timestamp: string
}

class WebhookEventEmitter extends EventEmitter {
  constructor() {
    super()
    // Every connected stream subscriber adds one listener. Node's default cap of 10 would
    // print a MaxListenersExceededWarning as soon as an 11th client connects.
    this.setMaxListeners(0)
  }

  emitWebhook(event: WebhookEvent): void {
    this.emit('webhook', event)
  }
}

// Singleton instance to share across the plugin
export const webhookEventEmitter = new WebhookEventEmitter()
