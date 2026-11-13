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

export type Endpoint = {
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

export type DeliveryResult = {
  durationMs: number
  error?: string
  ok: boolean
  responseBody?: string
  status?: number
}

/** Plain-language next step for common failures, shown in the delivery log. */
export const hintFor = ({ code, status }: { code?: string; status?: number }): string => {
  if (status === 401 || status === 403) {
    return 'The site rejected the credentials: check Authentication (type, token, header name).'
  }
  if (status === 404) {
    return 'Nothing exists at this URL: check it (for Home Assistant, the webhook id).'
  }
  if (status === 405) {
    return 'The site does not accept this method: try POST.'
  }
  if (status === 400 || status === 422) {
    return 'The site did not accept the request body. Services like Slack, Discord or Teams need their own message format; send to a relay such as n8n, Zapier, Make or Home Assistant instead.'
  }
  if (status !== undefined && status >= 500) {
    return 'The receiving site had an error; it will be retried automatically.'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'The host name could not be found: check the URL.'
  }
  if (code === 'ECONNREFUSED') {
    return 'Nothing is listening at that address and port: check the URL and that the site is running.'
  }
  if (code?.startsWith('CERT_') || code?.includes('SELF_SIGNED') || code?.includes('TLS')) {
    return "The site's HTTPS certificate is not trusted by this server."
  }
  return ''
}

const describeError = (error: unknown, timeoutSeconds: number): string => {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `No response within ${timeoutSeconds}s. Check the site is reachable from this server, or raise the timeout.`
  }
  const cause = error instanceof Error ? error.cause : undefined
  const code =
    cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : undefined
  const message =
    (cause instanceof Error ? cause.message : '') ||
    (error instanceof Error ? error.message : String(error))
  if (message === 'bad port') {
    return 'This port is blocked for outgoing requests by Node.js (a browser-style safety rule). Use a different port, e.g. 443, 80, 8123 or 8080.'
  }
  return [message, hintFor({ code })].filter(Boolean).join(' — ')
}

export const loadEndpointWithSecrets = async (
  payload: Payload,
  id: number | string,
): Promise<Endpoint | null> =>
  (await payload.findByID({
    id,
    collection: ENDPOINTS_SLUG,
    context: { [REVEAL_SECRETS_CONTEXT_KEY]: true, [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
    depth: 0,
    disableErrors: true,
    joins: false,
    overrideAccess: true,
  })) as Endpoint | null

/**
 * Make one HTTP attempt for a delivery and record the outcome on its log entry.
 */
export const sendDelivery = async ({
  body,
  deliveryId,
  endpoint,
  payload,
}: {
  body: Record<string, unknown>
  deliveryId: number | string
  endpoint: Endpoint
  payload: Payload
}): Promise<DeliveryResult> => {
  const timeoutSeconds = endpoint.timeoutSeconds || 10
  const rawBody = JSON.stringify({ ...body, deliveryId })
  const headers = buildRequestHeaders(endpoint, {
    body: rawBody,
    deliveryId,
    event: String(body.event),
  })

  const started = Date.now()
  let result: DeliveryResult
  try {
    const response = await fetch(endpoint.url, {
      body: rawBody,
      headers,
      method: endpoint.method || 'POST',
      // Don't forward credentials to wherever a redirect points; treat 3xx as a failure.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    })
    const durationMs = Date.now() - started
    const responseBody = (await response.text().catch(() => '')).slice(0, MAX_RESPONSE_BODY)

    if (response.ok) {
      result = { durationMs, ok: true, responseBody, status: response.status }
    } else {
      const error =
        response.status >= 300 && response.status < 400
          ? `Redirected (${response.status}) to ${response.headers.get('location') ?? 'another address'}. Use that address as the URL.`
          : [`Received HTTP ${response.status}`, hintFor({ status: response.status })]
              .filter(Boolean)
              .join(' — ')
      result = { durationMs, error, ok: false, responseBody, status: response.status }
    }
  } catch (error) {
    result = {
      durationMs: Date.now() - started,
      error: describeError(error, timeoutSeconds),
      ok: false,
    }
  }

  await recordAttempt(payload, deliveryId, {
    durationMs: result.durationMs,
    error: result.error ?? null,
    responseBody: result.responseBody ?? null,
    responseStatus: result.status ?? null,
    status: result.ok ? 'success' : 'failed',
  })

  return result
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

    const endpoint = await loadEndpointWithSecrets(payload, endpointId)

    if (!endpoint || !endpoint.enabled) {
      await recordAttempt(payload, deliveryId, {
        error: endpoint
          ? 'The endpoint was disabled before this was sent.'
          : 'The endpoint was deleted before this was sent.',
        status: 'skipped',
      })
      return { output: { skipped: true } }
    }

    const result = await sendDelivery({ body, deliveryId, endpoint, payload })
    if (!result.ok) {
      throw new Error(`Webhook delivery failed: ${result.error}`)
    }

    await pruneOldDeliveries(payload, retainDays)
    return { output: { status: result.status } }
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
