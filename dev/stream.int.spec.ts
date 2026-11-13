import type { Payload, PayloadHandler, TypedUser } from 'payload'

import config from '@payload-config'
import { createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { webhookEventEmitter } from '../src/hooks/webhookEventEmitter.js'

type StreamMessage = Record<string, unknown>

let payload: Payload
let streamHandler: PayloadHandler
let admin: TypedUser
let editor: TypedUser

const openStream = async (user?: TypedUser) => {
  const req = await createLocalReq({ user }, payload)
  const response = await streamHandler(req)
  const messages: StreamMessage[] = []

  if (response.status !== 200 || !response.body) {
    return {
      close: () => Promise.resolve(),
      messages,
      response,
      waitFor: () => Promise.resolve({}),
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const waiters: Array<{
    predicate: (m: StreamMessage) => boolean
    resolve: (m: StreamMessage) => void
  }> = []
  let buffer = ''

  void (async () => {
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (done) {
        return
      }
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
        if (!frame.startsWith('data: ')) {
          continue
        }
        const message = JSON.parse(frame.slice(6)) as StreamMessage
        messages.push(message)
        for (const waiter of [...waiters]) {
          if (waiter.predicate(message)) {
            waiters.splice(waiters.indexOf(waiter), 1)
            waiter.resolve(message)
          }
        }
      }
    }
  })()

  const waitFor = (predicate: (m: StreamMessage) => boolean, timeoutMs = 5_000) => {
    const existing = messages.find(predicate)
    if (existing) {
      return Promise.resolve(existing)
    }
    return new Promise<StreamMessage>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for stream message')),
        timeoutMs,
      )
      waiters.push({
        predicate,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m)
        },
      })
    })
  }

  await waitFor((m) => m.type === 'connected')

  return { close: () => reader.cancel(), messages, response, waitFor }
}

/** Create a published post everyone can see; once it arrives, earlier events have too. */
const sentinel = async () => {
  const doc = await payload.create({
    collection: 'posts',
    data: { status: 'published', title: `sentinel-${Date.now()}-${Math.random()}` },
  })
  return (m: StreamMessage) => m.action === 'create' && m.id === doc.id
}

const eventsFor = (messages: StreamMessage[], id: number | string) =>
  messages.filter((m) => m.id === id)

beforeAll(async () => {
  payload = await getPayload({ config })

  const endpoint = payload.config.endpoints.find((e) => e.path === '/webhooks/stream')
  if (!endpoint) {
    throw new Error('webhook stream endpoint not registered')
  }
  streamHandler = endpoint.handler

  const created = await Promise.all([
    payload.create({
      collection: 'users',
      data: { email: `admin-${Date.now()}@example.com`, password: 'test', role: 'admin' },
    }),
    payload.create({
      collection: 'users',
      data: { email: `editor-${Date.now()}@example.com`, password: 'test', role: 'editor' },
    }),
  ])
  admin = { ...created[0], collection: 'users' } as TypedUser
  editor = { ...created[1], collection: 'users' } as TypedUser

  const operations = { create: true, delete: true, read: false, update: true }
  await payload.updateGlobal({
    slug: 'webhooks',
    data: {
      collections: [
        { collection: 'posts', enabled: true, operations },
        { collection: 'internal-notes', enabled: true, operations },
      ],
    },
  })
})

afterAll(async () => {
  await payload.destroy()
})

describe('webhook stream', () => {
  test('rejects unauthenticated requests', async () => {
    const { response } = await openStream()
    expect(response.status).toBe(401)
  })

  test('delivers committed creates with the document re-read as the subscriber', async () => {
    const stream = await openStream(admin)
    const post = await payload.create({
      collection: 'posts',
      data: { internalNote: 'admins only', status: 'published', title: 'Hello' },
    })

    const event = await stream.waitFor((m) => m.action === 'create' && m.id === post.id)
    expect(event).toMatchObject({
      collection: 'posts',
      data: { id: post.id, internalNote: 'admins only', title: 'Hello' },
    })
    await stream.close()
  })

  test('applies collection access, including query-based access, per subscriber', async () => {
    const adminStream = await openStream(admin)
    const editorStream = await openStream(editor)

    const draft = await payload.create({
      collection: 'posts',
      data: { status: 'draft', title: 'Unpublished' },
    })
    const note = await payload.create({ collection: 'internal-notes', data: { body: 'secret' } })
    const done = await sentinel()

    await Promise.all([adminStream.waitFor(done), editorStream.waitFor(done)])

    expect(eventsFor(adminStream.messages, draft.id)).toHaveLength(1)
    expect(eventsFor(adminStream.messages, note.id)).toHaveLength(1)
    expect(eventsFor(editorStream.messages, draft.id)).toHaveLength(0)
    expect(eventsFor(editorStream.messages, note.id)).toHaveLength(0)

    await Promise.all([adminStream.close(), editorStream.close()])
  })

  test('strips fields the subscriber cannot read from data and previousData', async () => {
    const editorStream = await openStream(editor)
    const post = await payload.create({
      collection: 'posts',
      data: { internalNote: 'v1 note', status: 'published', title: 'v1' },
    })
    await payload.update({
      id: post.id,
      collection: 'posts',
      data: { internalNote: 'v2 note', title: 'v2' },
    })

    const created = await editorStream.waitFor((m) => m.action === 'create' && m.id === post.id)
    const updated = await editorStream.waitFor((m) => m.action === 'update' && m.id === post.id)

    expect(created.data).toMatchObject({ title: 'v1' })
    expect(created.data).not.toHaveProperty('internalNote')
    expect(updated.data).toMatchObject({ title: 'v2' })
    expect(updated.data).not.toHaveProperty('internalNote')
    expect(updated.previousData).toMatchObject({ title: 'v1' })
    expect(updated.previousData).not.toHaveProperty('internalNote')

    await editorStream.close()
  })

  test('sends delete events as id only, to subscribers with read access', async () => {
    const adminStream = await openStream(admin)
    const editorStream = await openStream(editor)

    const note = await payload.create({ collection: 'internal-notes', data: { body: 'bye' } })
    await payload.delete({ id: note.id, collection: 'internal-notes' })

    const deleted = await adminStream.waitFor((m) => m.action === 'delete' && m.id === note.id)
    expect(deleted).not.toHaveProperty('data')

    const done = await sentinel()
    await editorStream.waitFor(done)
    expect(eventsFor(editorStream.messages, note.id)).toHaveLength(0)

    await Promise.all([adminStream.close(), editorStream.close()])
  })

  test('does not emit events for rolled-back transactions', async () => {
    const stream = await openStream(admin)

    const req = await createLocalReq({}, payload)
    await initTransaction(req)
    const rolledBack = await payload.create({
      collection: 'posts',
      data: { status: 'published', title: 'never committed' },
      req,
    })
    await killTransaction(req)

    const done = await sentinel()
    await stream.waitFor(done)
    expect(eventsFor(stream.messages, rolledBack.id)).toHaveLength(0)

    await stream.close()
  })

  test('removes its listener when the client disconnects and has no listener cap', async () => {
    expect(webhookEventEmitter.getMaxListeners()).toBe(0)

    const before = webhookEventEmitter.listenerCount('webhook')
    const stream = await openStream(admin)
    expect(webhookEventEmitter.listenerCount('webhook')).toBe(before + 1)

    await stream.close()
    expect(webhookEventEmitter.listenerCount('webhook')).toBe(before)
  })
})
