import type { Payload, TaskConfig } from 'payload'

import { createHmac } from 'node:crypto'

import type { DeliveryInput } from './enqueueDeliveries.js'

import { SKIP_WEBHOOKS_CONTEXT_KEY } from '../hooks/webhookHandler.js'
import {
  DELIVER_TASK_SLUG,
  DELIVERIES_SLUG,
  DELIVERY_HEADER,
  ENDPOINTS_SLUG,
  EVENT_HEADER,
  SIGNATURE_HEADER,
} from './constants.js'
import { REVEAL_SECRETS_CONTEXT_KEY } from './secrets.js'

const MAX_RESPONSE_BODY = 2048

type Endpoint = {
  authentication?: {
    headerName?: null | string
    headerValue?: null | string
    password?: null | string
    token?: null | string
    type?: 'basic' | 'bearer' | 'header' | 'none' | null
    username?: null | string
  }
  enabled?: boolean | null
  headers?: { name: string; value: string }[] | null
  method?: null | string
  signingSecret?: null | string
  timeoutSeconds?: null | number
  url: string
}

export const signBody = (secret: string, timestamp: number, body: string): string =>
  `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`

export const buildRequestHeaders = (
  endpoint: Endpoint,
  { body, deliveryId, event }: { body: string; deliveryId: number | string; event: string },
): Headers => {
  const headers = new Headers()

  for (const { name, value } of endpoint.headers ?? []) {
    if (name && value) {
      headers.set(name, value)
    }
  }

  const auth = endpoint.authentication
  if (auth?.type === 'bearer' && auth.token) {
    headers.set('Authorization', `Bearer ${auth.token}`)
  } else if (auth?.type === 'basic' && auth.username) {
    const encoded = Buffer.from(`${auth.username}:${auth.password ?? ''}`).toString('base64')
    headers.set('Authorization', `Basic ${encoded}`)
  } else if (auth?.type === 'header' && auth.headerName && auth.headerValue) {
    headers.set(auth.headerName, auth.headerValue)
  }

  headers.set('Content-Type', 'application/json')
  headers.set('User-Agent', 'payload-plugin-webhooks')
  headers.set(EVENT_HEADER, event)
  headers.set(DELIVERY_HEADER, String(deliveryId))

  if (endpoint.signingSecret) {
    headers.set(
      SIGNATURE_HEADER,
      signBody(endpoint.signingSecret, Math.floor(Date.now() / 1000), body),
    )
  }

  return headers
}

const recordAttempt = async (
  payload: Payload,
  deliveryId: number | string,
  data: Record<string, unknown>,
) => {
  try {
    const existing = await payload.findByID({
      id: deliveryId,
      collection: DELIVERIES_SLUG,
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
      select: { attempts: true },
    })
    await payload.update({
      id: deliveryId,
      collection: DELIVERIES_SLUG,
      context: { [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
      data: {
        ...data,
        attempts: (Number((existing as { attempts?: number } | null)?.attempts) || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
  } catch (_error) {
    // The log is best-effort; never let it decide whether a delivery is retried.
  }
}

const pruneOldDeliveries = async (payload: Payload, retainDays: number) => {
  if (retainDays <= 0) {
    return
  }
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString()
  try {
    await payload.db.deleteMany({
      collection: DELIVERIES_SLUG,
      where: { createdAt: { less_than: cutoff } },
    })
  } catch (_error) {
    // best-effort
  }
}

export const createDeliverTask = ({
  retainDays,
  retries,
}: {
  retainDays: number
  retries: number
}): TaskConfig => ({
  slug: DELIVER_TASK_SLUG,
  handler: async ({ input, req }) => {
    // Use the jobs runner's payload, but not its req/transaction: delivery log writes must
    // persist even when this attempt throws to request a retry.
    const { payload } = req
    const { body, deliveryId, endpointId } = input as DeliveryInput

    const endpoint = (await payload.findByID({
      id: endpointId,
      collection: ENDPOINTS_SLUG,
      context: { [REVEAL_SECRETS_CONTEXT_KEY]: true, [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
    })) as Endpoint | null

    if (!endpoint || !endpoint.enabled) {
      await recordAttempt(payload, deliveryId, {
        error: endpoint ? 'Endpoint is disabled.' : 'Endpoint was deleted.',
        status: 'skipped',
      })
      return { output: { skipped: true } }
    }

    const rawBody = JSON.stringify({ ...body, deliveryId })
    const headers = buildRequestHeaders(endpoint, {
      body: rawBody,
      deliveryId,
      event: String(body.event),
    })

    const started = Date.now()
    let response: Response
    try {
      response = await fetch(endpoint.url, {
        body: rawBody,
        headers,
        method: endpoint.method || 'POST',
        // Don't forward credentials to wherever a redirect points; treat 3xx as a failure.
        redirect: 'manual',
        signal: AbortSignal.timeout((endpoint.timeoutSeconds || 10) * 1000),
      })
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? `Timed out after ${endpoint.timeoutSeconds || 10}s`
          : error instanceof Error
            ? (error.cause instanceof Error ? error.cause.message : '') || error.message
            : String(error)
      await recordAttempt(payload, deliveryId, {
        durationMs: Date.now() - started,
        error: message,
        status: 'failed',
      })
      throw new Error(`Webhook delivery failed: ${message}`)
    }

    const durationMs = Date.now() - started
    const responseBody = (await response.text().catch(() => '')).slice(0, MAX_RESPONSE_BODY)

    if (!response.ok) {
      const error =
        response.status >= 300 && response.status < 400
          ? `Redirected (${response.status}) to ${response.headers.get('location') ?? 'unknown'}; update the URL.`
          : `Received HTTP ${response.status}`
      await recordAttempt(payload, deliveryId, {
        durationMs,
        error,
        responseBody,
        responseStatus: response.status,
        status: 'failed',
      })
      throw new Error(`Webhook delivery failed: ${error}`)
    }

    await recordAttempt(payload, deliveryId, {
      durationMs,
      error: null,
      responseBody,
      responseStatus: response.status,
      status: 'success',
    })
    await pruneOldDeliveries(payload, retainDays)

    return { output: { status: response.status } }
  },
  inputSchema: [
    { name: 'endpointId', type: 'json', required: true },
    { name: 'deliveryId', type: 'json', required: true },
    { name: 'body', type: 'json', required: true },
  ],
  label: 'Deliver webhook',
  retries: {
    attempts: retries,
    backoff: { type: 'exponential', delay: 30_000 },
  },
})
