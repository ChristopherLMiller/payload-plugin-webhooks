import type { Access, CollectionConfig, Field, Validate } from 'payload'

import {
  DELIVERIES_SLUG,
  DELIVERY_HEADER,
  ENDPOINTS_SLUG,
  EVENT_HEADER,
  SIGNATURE_HEADER,
} from './constants.js'
import { invalidateEndpointCache } from './matchEndpoints.js'
import { secretField } from './secrets.js'
import { createTestEndpoint } from './testEndpoint.js'

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

  const uiField = (name: string, component: string, position?: 'sidebar'): Field => ({
    name,
    type: 'ui',
    admin: {
      components: { Field: `payload-plugin-webhooks/client#${component}` },
      ...(position ? { position } : {}),
    },
  })

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
        'Call another website (Home Assistant, Zapier, n8n, your own API, …) when documents are created, updated or deleted. Open an endpoint for step-by-step setup help and a test button.',
      group: 'Webhooks',
      useAsTitle: 'name',
    },
    endpoints: [createTestEndpoint({ runAsCollection })],
    fields: [
      // Sidebar
      uiField('sendTest', 'SendTestButton', 'sidebar'),
      {
        name: 'enabled',
        type: 'checkbox',
        admin: {
          description: 'Turn off to stop sending without deleting the endpoint.',
          position: 'sidebar',
        },
        defaultValue: true,
      },
      {
        name: 'runAs',
        type: 'relationship',
        admin: {
          description:
            'Documents are read with this user’s access before sending, so the other site only gets what this user can read. For external sites, create a dedicated user with limited access.',
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
            'Send the document (and, for updates, the previous version). Turn off to send only the collection, action and id.',
          position: 'sidebar',
        },
        defaultValue: true,
        label: 'Include document',
      },
      {
        name: 'timeoutSeconds',
        type: 'number',
        admin: {
          description: 'How long to wait for the other site to answer before retrying.',
          position: 'sidebar',
        },
        defaultValue: 10,
        label: 'Timeout (seconds)',
        max: 60,
        min: 1,
      },

      // Main area
      {
        type: 'tabs',
        tabs: [
          {
            fields: [
              uiField('setupGuide', 'EndpointSetupGuide'),
              {
                name: 'name',
                type: 'text',
                admin: { description: 'A label for your own reference, e.g. "Home Assistant".' },
                required: true,
              },
              {
                type: 'row',
                fields: [
                  {
                    name: 'method',
                    type: 'select',
                    admin: {
                      description: 'Almost always POST.',
                      width: '20%',
                    },
                    defaultValue: 'POST',
                    options: ['POST', 'PUT', 'PATCH'],
                    required: true,
                  },
                  {
                    name: 'url',
                    type: 'text',
                    admin: {
                      description:
                        'The incoming-webhook address from the other site. See "How to set up a webhook" above for where to find it.',
                      placeholder: 'https://',
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
                admin: {
                  description:
                    'A request is sent for every change that matches both a collection and an operation.',
                },
                fields: [
                  {
                    type: 'row',
                    fields: [
                      {
                        name: 'collections',
                        type: 'select',
                        admin: { width: '50%' },
                        hasMany: true,
                        options: collectionOptions,
                        required: true,
                      },
                      {
                        name: 'operations',
                        type: 'select',
                        admin: { width: '50%' },
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
                ],
              },
              {
                name: 'authentication',
                type: 'group',
                admin: {
                  description:
                    'Only needed if the other site asks for a token, password or API key. Most incoming-webhook URLs (Home Assistant, Zapier, Make, IFTTT) need None.',
                },
                fields: [
                  {
                    name: 'type',
                    type: 'select',
                    defaultValue: 'none',
                    options: [
                      { label: 'None', value: 'none' },
                      { label: 'Bearer token (Authorization: Bearer …)', value: 'bearer' },
                      { label: 'Username & password (Basic auth)', value: 'basic' },
                      { label: 'Custom header (e.g. X-API-Key)', value: 'header' },
                    ],
                    required: true,
                  },
                  secretField({
                    name: 'token',
                    condition: authIs('bearer'),
                    description:
                      'Sent as "Authorization: Bearer <token>". For Home Assistant’s REST API, create a long-lived access token on your HA profile page.',
                    label: 'Token',
                  }),
                  {
                    type: 'row',
                    admin: { condition: authIs('basic') },
                    fields: [
                      { name: 'username', type: 'text', admin: { condition: authIs('basic') } },
                      secretField({
                        name: 'password',
                        condition: authIs('basic'),
                        label: 'Password',
                      }),
                    ],
                  },
                  {
                    type: 'row',
                    admin: { condition: authIs('header') },
                    fields: [
                      {
                        name: 'headerName',
                        type: 'text',
                        admin: {
                          condition: authIs('header'),
                          description: 'The header the other site reads the key from.',
                          placeholder: 'X-API-Key',
                        },
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
              {
                type: 'collapsible',
                admin: {
                  description: 'Usually not needed. Use these when you control the receiving code.',
                  initCollapsed: true,
                },
                fields: [
                  secretField({
                    name: 'signingSecret',
                    description: `Lets your own code prove a request came from this site. Each request gets a "${SIGNATURE_HEADER}: t=<unix time>,v1=<hex>" header, where v1 is the HMAC-SHA256 of "<t>.<raw body>" using this secret. No-code tools ignore it.`,
                    label: 'Signing secret',
                  }),
                  {
                    name: 'headers',
                    type: 'array',
                    admin: {
                      description: `Extra headers sent with every request. Not encrypted, so put secrets under Authentication. "${EVENT_HEADER}" and "${DELIVERY_HEADER}" are always sent.`,
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
                label: 'Advanced',
              },
              uiField('requestPreview', 'RequestPreview'),
            ],
            label: 'Setup',
          },
          {
            description:
              'The latest requests to this endpoint. Failed requests are retried automatically with increasing delays; open one to see the full error and response.',
            fields: [
              {
                name: 'deliveries',
                type: 'join',
                admin: {
                  allowCreate: false,
                  defaultColumns: ['event', 'status', 'responseStatus', 'attempts', 'createdAt'],
                },
                collection: DELIVERIES_SLUG,
                defaultLimit: 20,
                defaultSort: '-createdAt',
                label: 'Recent deliveries',
                on: 'endpoint',
              },
            ],
            label: 'Delivery log',
          },
        ],
      },
    ],
    hooks: {
      afterChange: [() => invalidateEndpointCache()],
      afterDelete: [() => invalidateEndpointCache()],
    },
    labels: { plural: 'Webhook Endpoints', singular: 'Webhook Endpoint' },
  }
}
