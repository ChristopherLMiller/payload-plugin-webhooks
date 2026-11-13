import type { Access, CollectionConfig } from 'payload'

import { DELIVERIES_SLUG, ENDPOINTS_SLUG } from './constants.js'

export const createDeliveriesCollection = ({ access }: { access: Access }): CollectionConfig => ({
  slug: DELIVERIES_SLUG,
  access: {
    // Written only by the plugin (local API).
    create: () => false,
    delete: access,
    read: access,
    update: () => false,
  },
  admin: {
    defaultColumns: ['event', 'endpoint', 'status', 'responseStatus', 'attempts', 'createdAt'],
    description:
      'One entry per request sent by a Webhook Endpoint. Delivered: the other site answered with a 2xx status. Failed: the latest attempt failed; it is retried automatically with increasing delays, and Attempts counts the tries so far. Skipped: the endpoint was disabled or deleted before sending. Pending: queued. Open an entry for the error and the response. Request bodies are not stored.',
    group: 'Webhooks',
    useAsTitle: 'event',
  },
  fields: [
    {
      name: 'endpoint',
      type: 'relationship',
      index: true,
      relationTo: ENDPOINTS_SLUG,
    },
    {
      name: 'event',
      type: 'text',
      admin: {
        description: 'Collection and action, e.g. posts.update. "webhook.test" is a test request.',
      },
    },
    { name: 'documentId', type: 'text', index: true, label: 'Document ID' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Delivered', value: 'success' },
        { label: 'Failed', value: 'failed' },
        { label: 'Skipped', value: 'skipped' },
      ],
    },
    { name: 'attempts', type: 'number', defaultValue: 0 },
    { name: 'responseStatus', type: 'number', label: 'Response status' },
    { name: 'durationMs', type: 'number', label: 'Duration (ms)' },
    { name: 'lastAttemptAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
    {
      name: 'error',
      type: 'textarea',
      admin: { description: 'Why the latest attempt failed or was skipped, and what to check.' },
    },
    {
      name: 'responseBody',
      type: 'textarea',
      admin: { description: 'First 2 KB of the response.' },
      label: 'Response body',
    },
  ],
  labels: { plural: 'Webhook Deliveries', singular: 'Webhook Delivery' },
})
