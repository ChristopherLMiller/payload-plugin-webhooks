import type { Access, CollectionConfig, Validate } from 'payload'

import { DELIVERY_HEADER, ENDPOINTS_SLUG, EVENT_HEADER, SIGNATURE_HEADER } from './constants.js'
import { invalidateEndpointCache } from './matchEndpoints.js'
import { secretField } from './secrets.js'

type Options = {
  access: Access
  /** Who may pick a "Run as" user other than themselves. */
  assignRunAs: Access
  collectionOptions: { label: string; value: string }[]
  runAsCollection: string
}

const authIs =
  (type: string) =>
  (_data: unknown, siblingData: Record<string, unknown> | undefined): boolean =>
    siblingData?.type === type

const validateUrl: Validate<null | string | undefined> = (value) => {
  if (!value) {
    return 'A URL is required.'
  }
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? true
      : 'The URL must start with http:// or https://'
  } catch (_error) {
    return 'Enter a full URL, e.g. https://homeassistant.local:8123/api/webhook/my-hook'
  }
}

const idOf = (value: unknown): unknown =>
  value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value

export const createEndpointsCollection = ({
  access,
  assignRunAs,
  collectionOptions,
  runAsCollection,
}: Options): CollectionConfig => {
  const validateRunAs: Validate = async (value, { id, overrideAccess, previousValue, req }) => {
    if (!value) {
      return 'Choose the user whose access is used to read documents for this webhook.'
    }
    // Local API / system writes, unchanged values, and the current user are always fine.
    if (overrideAccess || !req.user) {
      return true
    }
    if (String(idOf(value)) === String(req.user.id)) {
      return true
    }
    if (previousValue !== undefined && String(idOf(value)) === String(idOf(previousValue))) {
      return true
    }
    const allowed = await assignRunAs({ id, req })
    return allowed
      ? true
      : 'You can only set "Run as" to yourself. Ask an administrator to choose another user.'
  }

  return {
    slug: ENDPOINTS_SLUG,
    access: {
      create: access,
      delete: access,
      read: access,
      update: access,
    },
    admin: {
      defaultColumns: ['name', 'url', 'enabled', 'updatedAt'],
      description:
        'Send an HTTP request to another service (for example a Home Assistant webhook) when documents change. Each change is delivered in the background with automatic retries; see Webhook Deliveries for results.',
      group: 'Webhooks',
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        admin: { description: 'A label for your own reference, e.g. "Home Assistant".' },
        required: true,
      },
      {
        name: 'enabled',
        type: 'checkbox',
        admin: { position: 'sidebar' },
        defaultValue: true,
      },
      {
        type: 'row',
        fields: [
          {
            name: 'method',
            type: 'select',
            admin: { width: '20%' },
            defaultValue: 'POST',
            options: ['POST', 'PUT', 'PATCH'],
            required: true,
          },
          {
            name: 'url',
            type: 'text',
            admin: {
              description:
                'The full address to call. For a Home Assistant webhook trigger: https://<your-ha>/api/webhook/<webhook_id>',
              width: '80%',
            },
            label: 'URL',
            required: true,
            validate: validateUrl,
          },
        ],
      },
      {
        name: 'events',
        type: 'group',
        admin: { description: 'Which changes send a request to this URL.' },
        fields: [
          {
            name: 'collections',
            type: 'select',
            admin: { description: 'Changes to documents in these collections.' },
            hasMany: true,
            options: collectionOptions,
            required: true,
          },
          {
            name: 'operations',
            type: 'select',
            admin: { description: 'Which kinds of change.' },
            defaultValue: ['create', 'update', 'delete'],
            hasMany: true,
            options: [
              { label: 'Create', value: 'create' },
              { label: 'Update', value: 'update' },
              { label: 'Delete', value: 'delete' },
            ],
            required: true,
          },
        ],
      },
      {
        name: 'runAs',
        type: 'relationship',
        admin: {
          description:
            'Documents are read with this user’s access before they are sent, so the receiving service only gets what this user may read. Create a dedicated user with limited access for external services. Delete events only include the document id.',
          position: 'sidebar',
        },
        defaultValue: ({ user }: { user?: { id: number | string } | null }) => user?.id,
        label: 'Run as',
        relationTo: runAsCollection,
        required: true,
        validate: validateRunAs,
      },
      {
        name: 'includeDocument',
        type: 'checkbox',
        admin: {
          description:
            'Include the document (and previous version, for updates) in the request body. Turn off to send only the collection, action and id.',
          position: 'sidebar',
        },
        defaultValue: true,
      },
      {
        name: 'timeoutSeconds',
        type: 'number',
        admin: { position: 'sidebar' },
        defaultValue: 10,
        label: 'Timeout (seconds)',
        max: 60,
        min: 1,
      },
      {
        name: 'authentication',
        type: 'group',
        admin: { description: 'How this request proves itself to the receiving service.' },
        fields: [
          {
            name: 'type',
            type: 'select',
            admin: {
              description:
                'Home Assistant webhook triggers need none (the webhook id in the URL is the secret). Home Assistant’s REST API uses a Bearer long-lived access token.',
            },
            defaultValue: 'none',
            options: [
              { label: 'None', value: 'none' },
              { label: 'Bearer token', value: 'bearer' },
              { label: 'Basic (username & password)', value: 'basic' },
              { label: 'Custom header', value: 'header' },
            ],
            required: true,
          },
          secretField({
            name: 'token',
            condition: authIs('bearer'),
            description: 'Sent as "Authorization: Bearer <token>".',
            label: 'Token',
          }),
          {
            type: 'row',
            admin: { condition: authIs('basic') },
            fields: [
              { name: 'username', type: 'text', admin: { condition: authIs('basic') } },
              secretField({ name: 'password', condition: authIs('basic'), label: 'Password' }),
            ],
          },
          {
            type: 'row',
            admin: { condition: authIs('header') },
            fields: [
              {
                name: 'headerName',
                type: 'text',
                admin: { condition: authIs('header'), placeholder: 'X-API-Key' },
                label: 'Header name',
              },
              secretField({
                name: 'headerValue',
                condition: authIs('header'),
                label: 'Header value',
              }),
            ],
          },
        ],
      },
      secretField({
        name: 'signingSecret',
        description: `Optional. When set, each request carries a "${SIGNATURE_HEADER}: t=<unix time>,v1=<hex>" header, where v1 is the HMAC-SHA256 of "<t>.<raw body>" with this secret, so the receiver can verify the request came from here.`,
        label: 'Signing secret',
      }),
      {
        name: 'headers',
        type: 'array',
        admin: {
          description: `Extra headers sent with every request. Not encrypted; use Authentication for secrets. Requests also include "${EVENT_HEADER}" (e.g. posts.update) and "${DELIVERY_HEADER}" (a unique id per delivery).`,
          initCollapsed: true,
        },
        fields: [
          {
            type: 'row',
            fields: [
              { name: 'name', type: 'text', required: true },
              { name: 'value', type: 'text', required: true },
            ],
          },
        ],
        label: 'Additional headers',
      },
    ],
    hooks: {
      afterChange: [() => invalidateEndpointCache()],
      afterDelete: [() => invalidateEndpointCache()],
    },
    labels: { plural: 'Webhook Endpoints', singular: 'Webhook Endpoint' },
  }
}
