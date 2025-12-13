import type { GlobalConfig } from 'payload'

export const WebhooksGlobal: GlobalConfig = {
  slug: 'webhooks',
  access: {
    read: () => true,
    update: ({ req }) => !!req.user,
  },
  admin: {
    description: 'Configure which collections and CRUD operations should emit webhook events.',
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
        description: 'Configure webhook events for each collection.',
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
            description: 'Select which CRUD operations should emit webhook events.',
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
  label: 'Webhooks',
}
