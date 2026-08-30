import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('Plugin integration tests', () => {
  test('webhooks global should exist', async () => {
    const global = await payload.findGlobal({
      slug: 'webhooks',
    })
    expect(global).toBeDefined()
  })

  test('does not register a plugin-owned api-keys collection', () => {
    expect('api-keys' in payload.collections).toBe(false)
  })

  test('uses Payload native API key strategy on users', () => {
    expect(payload.authStrategies.some((strategy) => strategy.name === 'users-api-key')).toBe(true)
  })
})
