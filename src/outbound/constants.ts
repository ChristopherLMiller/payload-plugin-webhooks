export const ENDPOINTS_SLUG = 'webhook-endpoints'
export const DELIVERIES_SLUG = 'webhook-deliveries'
export const DELIVER_TASK_SLUG = 'deliverWebhook'
export const WEBHOOKS_QUEUE = 'webhooks'

export const OUTBOUND_OPERATIONS = ['create', 'update', 'delete'] as const
export type OutboundOperation = (typeof OUTBOUND_OPERATIONS)[number]

export const SIGNATURE_HEADER = 'X-Webhook-Signature'
export const DELIVERY_HEADER = 'X-Webhook-Delivery'
export const EVENT_HEADER = 'X-Webhook-Event'
