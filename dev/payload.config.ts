import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadPluginWebhooks } from 'payload-plugin-webhooks'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  // Use memory database for test or if no DATABASE_URI is provided
  if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URI) {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 3,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URI = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'users',
        admin: { useAsTitle: 'email' },
        auth: {
          useAPIKey: true,
        },
        fields: [
          {
            name: 'role',
            type: 'select',
            defaultValue: 'editor',
            options: ['admin', 'editor'],
            required: true,
          },
        ],
      },
      {
        slug: 'posts',
        access: {
          // Admins see everything; everyone else only sees published posts.
          read: ({ req }) =>
            req.user?.role === 'admin' ? true : { status: { equals: 'published' } },
        },
        fields: [
          { name: 'title', type: 'text' },
          {
            name: 'status',
            type: 'select',
            defaultValue: 'draft',
            options: ['draft', 'published'],
          },
          {
            name: 'internalNote',
            type: 'text',
            access: {
              read: ({ req }) => req.user?.role === 'admin',
            },
          },
        ],
      },
      {
        slug: 'internal-notes',
        access: {
          read: ({ req }) => req.user?.role === 'admin',
        },
        fields: [{ name: 'body', type: 'text' }],
      },
      {
        slug: 'media',
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, 'media'),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URI || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [payloadPluginWebhooks()],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      // Generate types explicitly with `pnpm generate:types`. Auto-generation spawns a
      // `payload generate:types` child on every getPayload(); that child loads this config,
      // which starts an in-memory MongoDB that keeps it alive forever.
      autoGenerate: false,
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
