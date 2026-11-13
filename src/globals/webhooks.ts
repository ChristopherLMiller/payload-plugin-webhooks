import type { GlobalConfig } from 'payload'

export const WebhooksGlobal: GlobalConfig = {
  slug: 'webhooks',
  admin: {
    description:
      'Live event stream for apps and dashboards that stay connected to this site (Server-Sent Events at /api/webhooks/stream; clients authenticate like any API request). Choose which changes are pushed to them below. To call another website when something changes, use Webhook Endpoints instead.',
    group: 'Webhooks',
  },
  fields: [
    {
      name: 'collections',
      type: 'array',
      admin: {
        components: {
          RowLabel: 'payload-plugin-webhooks/client#WebhookCollectionRowLabel',
        },
        description:
          'Collections whose changes are pushed to connected stream clients. Clients only receive documents and fields their own user can read.',
      },
      fields: [
        {
          name: 'collection',
          type: 'select',
          admin: {
            description: 'Select a collection',
          },
          options: [], // Will be populated dynamically
          required: true,
        },
        {
          name: 'enabled',
          type: 'checkbox',
          defaultValue: true,
          label: 'Enabled',
        },
        {
          name: 'operations',
          type: 'group',
          admin: {
            description:
              'Which changes to push. Read sends an event every time a document is read, which can be very frequent.',
          },
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'create',
                  type: 'checkbox',
                  defaultValue: true,
                  label: 'Create',
                },
                {
                  name: 'read',
                  type: 'checkbox',
                  defaultValue: false,
                  label: 'Read',
                },
                {
                  name: 'update',
                  type: 'checkbox',
                  defaultValue: true,
                  label: 'Update',
                },
                {
                  name: 'delete',
                  type: 'checkbox',
                  defaultValue: true,
                  label: 'Delete',
                },
              ],
            },
          ],
          label: 'Operations',
        },
      ],
      label: 'Collection Settings',
    },
  ],
  label: 'Event Stream',
}
