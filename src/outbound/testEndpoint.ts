import type { Endpoint as PayloadEndpoint, PayloadRequest, TypedUser } from 'payload'

import { SKIP_WEBHOOKS_CONTEXT_KEY } from '../hooks/webhookHandler.js'
import { DELIVERIES_SLUG, ENDPOINTS_SLUG } from './constants.js'
import { loadEndpointWithSecrets, sendDelivery } from './deliverTask.js'

export const TEST_EVENT = 'webhook.test'

const json = (body: unknown, status = 200) =>
  Response.json(body, { headers: { 'Cache-Control': 'no-store' }, status })

const idOf = (value: unknown): number | string | undefined => {
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

/**
 * A sample document for the test request: the most recently updated document in the first
 * selected collection, read as the "Run as" user, so the receiver sees a realistic shape.
 */
const sampleDocument = async (
  req: PayloadRequest,
  collection: string | undefined,
  runAs: unknown,
  runAsCollection: string,
): Promise<Record<string, unknown> | undefined> => {
  const runAsId = idOf(runAs)
  if (!collection || runAsId === undefined || !req.payload.collections[collection]) {
    return undefined
  }
  try {
    const user = await req.payload.findByID({
      id: runAsId,
      collection: runAsCollection,
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
    })
    if (!user) {
      return undefined
    }
    const { docs } = await req.payload.find({
      collection,
      context: { [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
      depth: 0,
      limit: 1,
      overrideAccess: false,
      sort: '-updatedAt',
      user: { ...user, collection: runAsCollection } as TypedUser,
    })
    return docs[0] as Record<string, unknown> | undefined
  } catch (_error) {
    return undefined
  }
}

/**
 * POST /api/webhook-endpoints/:id/test — send a test request using the saved settings and
 * report the outcome. Available to anyone who can read the endpoint.
 */
export const createTestEndpoint = ({
  runAsCollection,
}: {
  runAsCollection: string
}): PayloadEndpoint => ({
  handler: async (req) => {
    const id = req.routeParams?.id as number | string | undefined
    if (!req.user) {
      return json({ error: 'You must be logged in.' }, 401)
    }
    if (id === undefined) {
      return json({ error: 'Missing endpoint id.' }, 400)
    }

    // Access check: the caller must be able to read this endpoint.
    const visible = await req.payload.findByID({
      id,
      collection: ENDPOINTS_SLUG,
      depth: 0,
      disableErrors: true,
      joins: false,
      overrideAccess: false,
      req,
    })
    if (!visible) {
      return json({ error: 'Webhook endpoint not found.' }, 404)
    }

    const endpoint = await loadEndpointWithSecrets(req.payload, id)
    if (!endpoint) {
      return json({ error: 'Webhook endpoint not found.' }, 404)
    }

    const record = visible as Record<string, unknown>
    const events = (record.events ?? {}) as { collections?: string[] }
    const firstCollection = events.collections?.[0]
    const sample =
      record.includeDocument === false
        ? undefined
        : await sampleDocument(req, firstCollection, record.runAs, runAsCollection)

    const body: Record<string, unknown> = {
      id: sample?.id ?? null,
      action: 'test',
      collection: firstCollection ?? null,
      event: TEST_EVENT,
      message:
        'Test request from Payload. Real events have "event" set to "<collection>.<create|update|delete>".',
      test: true,
      timestamp: new Date().toISOString(),
      ...(sample ? { data: sample } : {}),
    }

    const delivery = await req.payload.create({
      collection: DELIVERIES_SLUG,
      context: { [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
      data: { endpoint: id, event: TEST_EVENT, status: 'pending' },
      overrideAccess: true,
    })

    const result = await sendDelivery({
      body,
      deliveryId: delivery.id,
      endpoint,
      payload: req.payload,
    })

    return json({
      ...result,
      deliveryId: delivery.id,
      sentBody: { ...body, deliveryId: delivery.id },
    })
  },
  method: 'post',
  path: '/:id/test',
})
