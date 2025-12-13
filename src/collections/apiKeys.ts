import type { CollectionConfig } from 'payload'
import { ValidationError } from 'payload'
import crypto from 'crypto'

export const ApiKeys: CollectionConfig = {
  slug: 'api-keys',
  admin: {
    useAsTitle: 'user',
    description: 'Manage API keys for webhook stream authentication.',
    group: 'Webhooks',
  },
  access: {
    // Users can only read/update/delete their own API keys
    read: ({ req: { user } }) => {
      if (!user) return false
      return {
        user: {
          equals: user.id,
        },
      }
    },
    create: ({ req: { user } }) => !!user,
    update: ({ req: { user } }) => {
      if (!user) return false
      return {
        user: {
          equals: user.id,
        },
      }
    },
    delete: ({ req: { user } }) => {
      if (!user) return false
      return {
        user: {
          equals: user.id,
        },
      }
    },
  },
  hooks: {
    beforeValidate: [
      async ({ data, operation, req }) => {
        // Check if user already has an API key (only allow one per user)
        if (operation === 'create' && req.user) {
          const existing = await req.payload.find({
            collection: 'api-keys',
            where: {
              user: {
                equals: req.user.id,
              },
            },
            limit: 1,
          })

          if (existing.docs.length > 0) {
            throw new ValidationError({
              errors: [
                {
                  message: 'You already have an API key. Please delete the existing one first.',
                  path: 'user',
                },
              ],
            })
          }

          // Auto-assign the current user if not set
          if (data && !data.user) {
            data.user = req.user.id
          }
        }

        return data
      },
    ],
    beforeChange: [
      async ({ data, operation }) => {
        // Generate a strong API key on create if not provided
        if (operation === 'create' && data && !data.key) {
          // Generate a 32-byte (256-bit) random key and encode as base64url
          const randomBytes = crypto.randomBytes(32)
          data.key = randomBytes.toString('base64url')
        }

        return data
      },
    ],
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        description: 'The user this API key belongs to',
      },
      defaultValue: ({ user }) => user?.id,
      hasMany: false,
    },
    {
      name: 'key',
      type: 'text',
      required: true,
      admin: {
        description: 'The API key value. Keep this secret!',
        components: {
          Field: 'payload-plugin-webhooks/client#ApiKeyField',
          Cell: 'payload-plugin-webhooks/client#ApiKeyCell',
        },
      },
      hooks: {
        beforeChange: [
          async ({ value }) => {
            // Prevent manual changes to the key after creation
            return value
          },
        ],
      },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Disable this to temporarily deactivate the API key without deleting it',
      },
    },
    {
      name: 'lastUsed',
      type: 'date',
      admin: {
        readOnly: true,
        description: 'Last time this API key was used',
      },
    },
  ],
}
