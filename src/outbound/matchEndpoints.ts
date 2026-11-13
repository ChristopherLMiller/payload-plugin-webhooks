import type { Payload, PayloadRequest } from 'payload'

import { SKIP_WEBHOOKS_CONTEXT_KEY } from '../hooks/webhookHandler.js'
import { ENDPOINTS_SLUG, type OutboundOperation } from './constants.js'

export type EndpointSummary = {
  events: { collections: string[]; operations: OutboundOperation[] }
  id: number | string
  includeDocument: boolean
  runAs: number | string
}

const CACHE_TTL = 5000

let cache: { at: number; endpoints: EndpointSummary[] } | null = null

export const invalidateEndpointCache = (): void => {
  cache = null
}

const idOf = (value: unknown): number | string | undefined => {
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return typeof value === 'number' || typeof value === 'string' ? value : undefined
}

const loadEnabledEndpoints = async (
  payload: Payload,
  req: PayloadRequest,
): Promise<EndpointSummary[]> => {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return cache.endpoints
  }

  const { docs } = await payload.find({
    collection: ENDPOINTS_SLUG,
    context: { [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
    depth: 0,
    limit: 0,
    overrideAccess: true,
    pagination: false,
    req,
    select: { enabled: true, events: true, includeDocument: true, runAs: true },
    where: { enabled: { equals: true } },
  })

  const endpoints = docs.flatMap((doc): EndpointSummary[] => {
    const record = doc as Record<string, unknown>
    const events = (record.events ?? {}) as Partial<EndpointSummary['events']>
    const runAs = idOf(record.runAs)
    if (runAs === undefined) {
      return []
    }
    return [
      {
        id: doc.id,
        events: { collections: events.collections ?? [], operations: events.operations ?? [] },
        includeDocument: record.includeDocument !== false,
        runAs,
      },
    ]
  })

  cache = { at: Date.now(), endpoints }
  return endpoints
}

export const getMatchingEndpoints = async (
  req: PayloadRequest,
  collection: string,
  operation: OutboundOperation,
): Promise<EndpointSummary[]> => {
  const endpoints = await loadEnabledEndpoints(req.payload, req)
  return endpoints.filter(
    (endpoint) =>
      endpoint.events.collections.includes(collection) &&
      endpoint.events.operations.includes(operation),
  )
}
