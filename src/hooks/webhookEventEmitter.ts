import { EventEmitter } from 'node:events'

type CRUDAction = 'create' | 'delete' | 'read' | 'update'

export type WebhookPayload = {
  action: CRUDAction
  collection: string
  data?: unknown
  id?: number | string
  previousData?: unknown
  timestamp: string
}

class WebhookEventEmitter extends EventEmitter {
  emitWebhook(payload: WebhookPayload): void {
    this.emit('webhook', payload)
  }
}

// Singleton instance to share across the plugin
export const webhookEventEmitter = new WebhookEventEmitter()
