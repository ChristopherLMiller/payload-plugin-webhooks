import type { Payload, PayloadRequest, TypedUser } from 'payload'

import { createLocalReq } from 'payload'

import type { WebhookEvent, WebhookPayload } from '../hooks/webhookEventEmitter.js'

import { SKIP_WEBHOOKS_CONTEXT_KEY } from '../hooks/webhookHandler.js'

type Subscriber = {
  payload: Payload
  user: null | TypedUser | undefined
}

/**
 * Many subscribers are often the same user (several tabs, several services sharing one
 * API key). Cache the filtered result per event per user so each user costs one read.
 */
const resultCache = new WeakMap<WebhookEvent, Map<string, Promise<null | WebhookPayload>>>()

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

/**
 * Reduce `previous` to the shape of `visible` (the subscriber's access-filtered current
 * document), so fields hidden from the subscriber now are not leaked via previousData.
 */
export const projectOntoVisible = (previous: unknown, visible: unknown): unknown => {
  if (Array.isArray(visible)) {
    if (!Array.isArray(previous)) {
      return previous === undefined || previous === null ? previous : undefined
    }

    return previous.map((item, index) => {
      if (!isPlainObject(item)) {
        return visible.some((v) => isPlainObject(v)) ? undefined : item
      }

      // Array/block rows carry an `id`; match on it, then fall back to a row with the same
      // block type, then the same index.
      const match =
        visible.find((v) => isPlainObject(v) && item.id !== undefined && v.id === item.id) ??
        visible.find(
          (v) => isPlainObject(v) && item.blockType !== undefined && v.blockType === item.blockType,
        ) ??
        visible[index]

      return isPlainObject(match) ? projectOntoVisible(item, match) : { id: item.id }
    })
  }

  if (isPlainObject(visible)) {
    if (!isPlainObject(previous)) {
      return previous === undefined || previous === null ? previous : undefined
    }

    const projected: Record<string, unknown> = {}
    for (const key of Object.keys(visible)) {
      if (key in previous) {
        projected[key] = projectOntoVisible(previous[key], visible[key])
      }
    }
    return projected
  }

  return previous
}

const userKey = (user: Subscriber['user']): string =>
  user ? `${user.collection}:${String(user.id)}` : 'anonymous'

/**
 * Re-read the event's document as `user` (uncached). Pass `transactionID` to read inside
 * the writer's still-open transaction, e.g. from a collection hook.
 */
export const filterEventForUser = async (
  event: WebhookEvent,
  {
    payload,
    transactionID,
    user,
  }: { transactionID?: PayloadRequest['transactionID'] } & Subscriber,
): Promise<null | WebhookPayload> => {
  const collection = payload.collections[event.collection]
  if (!collection || event.id === undefined) {
    return null
  }

  const req = await createLocalReq(
    { context: { [SKIP_WEBHOOKS_CONTEXT_KEY]: true }, user: user ?? undefined },
    payload,
  )
  if (transactionID) {
    req.transactionID = transactionID
  }

  const base = {
    id: event.id,
    action: event.action,
    collection: event.collection,
    timestamp: event.timestamp,
  }

  if (event.action === 'delete') {
    // The document no longer exists, so it can't be re-read with the user's access.
    // Send only the id, and only to users with some read access to the collection.
    const readAccess = collection.config.access?.read
    if (!readAccess) {
      return user ? base : null
    }
    const result = await readAccess({ id: event.id, req })
    return result === false ? null : base
  }

  const data = await payload.findByID({
    id: event.id,
    collection: event.collection,
    depth: 0,
    disableErrors: true,
    draft: true,
    overrideAccess: false,
    req,
    trash: true,
  })

  if (!data) {
    return null
  }

  return {
    ...base,
    data,
    ...(event.previousDoc ? { previousData: projectOntoVisible(event.previousDoc, data) } : {}),
  }
}

/**
 * Turn an internal event into what this subscriber is allowed to see, by re-reading the
 * document as the subscriber with `overrideAccess: false`. That applies collection read
 * access (including query-based access), field-level access, and hidden fields.
 * Returns `null` when the subscriber may not see the event at all.
 */
export const filterEventForSubscriber = async (
  event: WebhookEvent,
  subscriber: Subscriber,
): Promise<null | WebhookPayload> => {
  let perUser = resultCache.get(event)
  if (!perUser) {
    perUser = new Map()
    resultCache.set(event, perUser)
  }

  const key = userKey(subscriber.user)
  let result = perUser.get(key)
  if (!result) {
    result = filterEventForUser(event, subscriber).catch(() => null)
    perUser.set(key, result)
  }

  return result
}
