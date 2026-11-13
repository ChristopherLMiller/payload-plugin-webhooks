import type { AddressInfo } from 'node:net'
import type { Payload, TypedUser } from 'payload'

import config from '@payload-config'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { createLocalReq, getPayload, initTransaction, killTransaction } from 'payload'
import { signBody } from 'payload-plugin-webhooks'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

type Received = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed JSON from the receiver
  body: Record<string, any>
  headers: IncomingHttpHeaders
  method: string
  path: string
  raw: string
}

let payload: Payload
let server: Server
let baseUrl: string
let admin: TypedUser
let editor: TypedUser

const received: Received[] = []
const responseStatusByPath = new Map<string, number>()

const waitFor = async <T>(
  check: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 8_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await check()
    if (result !== undefined) {
      return result
    }
    if (Date.now() > deadline) {
      throw new Error('Timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const requestsTo = (path: string) => received.filter((r) => r.path === path)

const createEndpoint = (path: string, data: Record<string, unknown> = {}) =>
  payload.create({
    collection: 'webhook-endpoints',
    data: {
      name: path,
      events: { collections: ['posts'], operations: ['create', 'update', 'delete'] },
      runAs: admin.id,
      url: `${baseUrl}${path}`,
      ...data,
    },
  })

const disable = (id: number | string) =>
  payload.update({ id, collection: 'webhook-endpoints', data: { enabled: false } })

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const path = req.url ?? '/'
      received.push({
        body: raw ? JSON.parse(raw) : {},
        headers: req.headers,
        method: req.method ?? '',
        path,
        raw,
      })
      res.statusCode = responseStatusByPath.get(path) ?? 200
      res.end('ok')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  payload = await getPayload({ config })

  const stamp = Date.now()
  admin = {
    ...(await payload.create({
      collection: 'users',
      data: { email: `ob-admin-${stamp}@example.com`, password: 'test', role: 'admin' },
    })),
    collection: 'users',
  } as TypedUser
  editor = {
    ...(await payload.create({
      collection: 'users',
      data: { email: `ob-editor-${stamp}@example.com`, password: 'test', role: 'editor' },
    })),
    collection: 'users',
  } as TypedUser
})

afterAll(async () => {
  await payload.destroy()
  await new Promise((resolve) => server.close(resolve))
})

describe('outbound webhooks', () => {
  test('delivers a signed, authenticated request after the change commits', async () => {
    const endpoint = await createEndpoint('/full', {
      authentication: { type: 'bearer', token: 'ha-long-lived-token' },
      headers: [{ name: 'X-Extra', value: 'yes' }],
      signingSecret: 'shh',
    })

    const post = await payload.create({
      collection: 'posts',
      data: { internalNote: 'admin only', status: 'published', title: 'Hello HA' },
    })

    const request = await waitFor(() => requestsTo('/full').find((r) => r.body.id === post.id))
    expect(request.method).toBe('POST')
    expect(request.headers.authorization).toBe('Bearer ha-long-lived-token')
    expect(request.headers['x-extra']).toBe('yes')
    expect(request.headers['x-webhook-event']).toBe('posts.create')
    expect(request.headers['content-type']).toBe('application/json')
    expect(request.body).toMatchObject({
      action: 'create',
      collection: 'posts',
      data: { internalNote: 'admin only', title: 'Hello HA' },
      event: 'posts.create',
    })
    expect(String(request.headers['x-webhook-delivery'])).toBe(String(request.body.deliveryId))

    const signature = String(request.headers['x-webhook-signature'])
    const t = Number(/t=(\d+)/.exec(signature)?.[1])
    expect(signature).toBe(signBody('shh', t, request.raw))

    const delivery = await waitFor(async () => {
      const doc = await payload.findByID({
        id: request.body.deliveryId,
        collection: 'webhook-deliveries',
      })
      return doc.status === 'success' ? doc : undefined
    })
    expect(delivery).toMatchObject({
      attempts: 1,
      documentId: String(post.id),
      event: 'posts.create',
      responseStatus: 200,
    })

    await disable(endpoint.id)
  })

  test('reads documents with the "Run as" user’s access', async () => {
    const endpoint = await createEndpoint('/editor', { runAs: editor.id })

    const draft = await payload.create({ collection: 'posts', data: { status: 'draft' } })
    const published = await payload.create({
      collection: 'posts',
      data: { internalNote: 'v1 note', status: 'published', title: 'v1' },
    })
    await payload.update({
      id: published.id,
      collection: 'posts',
      data: { internalNote: 'v2 note', title: 'v2' },
    })

    const update = await waitFor(() =>
      requestsTo('/editor').find(
        (r) => r.body.event === 'posts.update' && r.body.id === published.id,
      ),
    )
    expect(update.body.data).toMatchObject({ title: 'v2' })
    expect(update.body.data).not.toHaveProperty('internalNote')
    expect(update.body.previousData).toMatchObject({ title: 'v1' })
    expect(update.body.previousData).not.toHaveProperty('internalNote')
    expect(requestsTo('/editor').filter((r) => r.body.id === draft.id)).toHaveLength(0)

    await disable(endpoint.id)
  })

  test('only sends the id for deletes, and omits documents when includeDocument is off', async () => {
    const endpoint = await createEndpoint('/minimal', { includeDocument: false })
    const post = await payload.create({ collection: 'posts', data: { status: 'published' } })
    await payload.delete({ id: post.id, collection: 'posts' })

    const created = await waitFor(() =>
      requestsTo('/minimal').find((r) => r.body.event === 'posts.create' && r.body.id === post.id),
    )
    const deleted = await waitFor(() =>
      requestsTo('/minimal').find((r) => r.body.event === 'posts.delete' && r.body.id === post.id),
    )
    expect(created.body).not.toHaveProperty('data')
    expect(deleted.body).not.toHaveProperty('data')
    expect(deleted.body).toMatchObject({ id: post.id, action: 'delete', collection: 'posts' })

    await disable(endpoint.id)
  })

  test('records failures for retry', async () => {
    responseStatusByPath.set('/down', 503)
    const endpoint = await createEndpoint('/down')
    const post = await payload.create({ collection: 'posts', data: { status: 'published' } })

    const request = await waitFor(() => requestsTo('/down').find((r) => r.body.id === post.id))
    const delivery = await waitFor(async () => {
      const doc = await payload.findByID({
        id: request.body.deliveryId,
        collection: 'webhook-deliveries',
      })
      return doc.status === 'failed' ? doc : undefined
    })
    expect(delivery).toMatchObject({ attempts: 1, error: 'Received HTTP 503', responseStatus: 503 })

    const { docs: jobs } = await payload.find({
      collection: 'payload-jobs',
      where: { 'input.deliveryId': { equals: request.body.deliveryId } },
    })
    expect(jobs[0]).toMatchObject({ hasError: false, totalTried: 1 })
    expect(jobs[0].completedAt ?? null).toBeNull()
    expect(requestsTo('/down')).toHaveLength(1)
    expect(new Date(jobs[0].waitUntil as string).getTime()).toBeGreaterThan(Date.now())

    await disable(endpoint.id)
  })

  test('does not deliver or log anything for rolled-back transactions', async () => {
    const endpoint = await createEndpoint('/rollback')

    const req = await createLocalReq({}, payload)
    await initTransaction(req)
    const post = await payload.create({
      collection: 'posts',
      data: { status: 'published', title: 'never committed' },
      req,
    })
    await killTransaction(req)

    const sentinel = await payload.create({ collection: 'posts', data: { status: 'published' } })
    await waitFor(() => requestsTo('/rollback').find((r) => r.body.id === sentinel.id))

    expect(requestsTo('/rollback').filter((r) => r.body.id === post.id)).toHaveLength(0)
    const { totalDocs } = await payload.count({
      collection: 'webhook-deliveries',
      where: { documentId: { equals: String(post.id) } },
    })
    expect(totalDocs).toBe(0)

    await disable(endpoint.id)
  })

  test('stores secrets encrypted, masks them on read, and keeps them when the mask is resubmitted', async () => {
    const endpoint = await createEndpoint('/secret', {
      authentication: { type: 'header', headerName: 'X-Api-Key', headerValue: 'super-secret' },
    })

    const raw = (await payload.db.findOne({
      collection: 'webhook-endpoints',
      where: { id: { equals: endpoint.id } },
    })) as { authentication: { headerValue: string } }
    expect(raw.authentication.headerValue).toMatch(/^enc:v1:/)
    expect(raw.authentication.headerValue).not.toContain('super-secret')

    const read = await payload.findByID({ id: endpoint.id, collection: 'webhook-endpoints' })
    expect(read.authentication?.headerValue).toBe('••••••••')

    // What the admin form does on save: send everything back, including the mask.
    await payload.update({
      id: endpoint.id,
      collection: 'webhook-endpoints',
      data: { ...read, name: 'renamed' },
    })

    const post = await payload.create({ collection: 'posts', data: { status: 'published' } })
    const request = await waitFor(() => requestsTo('/secret').find((r) => r.body.id === post.id))
    expect(request.headers['x-api-key']).toBe('super-secret')

    await disable(endpoint.id)
  })

  test('only lets users run endpoints as themselves', async () => {
    await expect(
      payload.create({
        collection: 'webhook-endpoints',
        data: {
          name: 'escalate',
          events: { collections: ['posts'], operations: ['create'] },
          runAs: admin.id,
          url: `${baseUrl}/escalate`,
        },
        overrideAccess: false,
        user: editor,
      }),
    ).rejects.toThrow(/Run as/)

    const own = await payload.create({
      collection: 'webhook-endpoints',
      data: {
        name: 'own',
        enabled: false,
        events: { collections: ['posts'], operations: ['create'] },
        runAs: editor.id,
        url: `${baseUrl}/own`,
      },
      overrideAccess: false,
      user: editor,
    })
    expect(own.id).toBeDefined()
  })
})
