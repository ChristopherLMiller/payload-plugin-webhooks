import type { PayloadRequest, TypedUser } from 'payload'

import type { WebhookEvent } from '../hooks/webhookEventEmitter.js'

import { filterEventForUser } from '../endpoints/filterEventForSubscriber.js'
import { afterCommit } from '../hooks/transactionQueue.js'
import { SKIP_WEBHOOKS_CONTEXT_KEY } from '../hooks/webhookHandler.js'
import {
  DELIVER_TASK_SLUG,
  DELIVERIES_SLUG,
  type OutboundOperation,
  WEBHOOKS_QUEUE,
} from './constants.js'
import { getMatchingEndpoints } from './matchEndpoints.js'

export type DeliveryInput = {
  body: Record<string, unknown>
  deliveryId: number | string
  endpointId: number | string
}

/**
 * Called from collection hooks, inside the writer's transaction. For each matching
 * endpoint: snapshot the document as the endpoint's "Run as" user, record a pending
 * delivery, and queue a job. Because all of that uses the same transaction, nothing is
 * queued if the write rolls back. After commit, the job is started immediately; retries
 * are picked up by the jobs runner.
 */
export const enqueueDeliveries = async ({
  event,
  req,
  runAsCollection,
}: {
  event: { action: OutboundOperation } & WebhookEvent
  req: PayloadRequest
  runAsCollection: string
}): Promise<void> => {
  if (req.context?.[SKIP_WEBHOOKS_CONTEXT_KEY] || event.id === undefined) {
    return
  }

  const endpoints = await getMatchingEndpoints(req, event.collection, event.action)
  if (endpoints.length === 0) {
    return
  }

  const { payload } = req
  const users = new Map<string, null | TypedUser>()
  const snapshots = new Map<string, Awaited<ReturnType<typeof filterEventForUser>>>()

  for (const endpoint of endpoints) {
    const userKey = String(endpoint.runAs)

    if (!users.has(userKey)) {
      const user = await payload.findByID({
        id: endpoint.runAs,
        collection: runAsCollection,
        context: { [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
        depth: 0,
        disableErrors: true,
        overrideAccess: true,
        req,
      })
      users.set(userKey, user ? ({ ...user, collection: runAsCollection } as TypedUser) : null)
    }
    const user = users.get(userKey)
    if (!user) {
      // "Run as" user was deleted: nothing can be read on its behalf.
      continue
    }

    if (!snapshots.has(userKey)) {
      snapshots.set(
        userKey,
        await filterEventForUser(event, { payload, transactionID: req.transactionID, user }),
      )
    }
    const visible = snapshots.get(userKey)
    if (!visible) {
      // The "Run as" user cannot read this document.
      continue
    }

    const { data, previousData, ...rest } = visible
    const body: Record<string, unknown> = {
      ...rest,
      event: `${event.collection}.${event.action}`,
      ...(endpoint.includeDocument && data !== undefined ? { data } : {}),
      ...(endpoint.includeDocument && previousData !== undefined ? { previousData } : {}),
    }

    const delivery = await payload.create({
      collection: DELIVERIES_SLUG,
      context: { [SKIP_WEBHOOKS_CONTEXT_KEY]: true },
      data: {
        documentId: String(event.id),
        endpoint: endpoint.id,
        event: body.event,
        status: 'pending',
      },
      overrideAccess: true,
      req,
    })

    const input: DeliveryInput = { body, deliveryId: delivery.id, endpointId: endpoint.id }
    const job = await payload.jobs.queue({
      input,
      queue: WEBHOOKS_QUEUE,
      req,
      task: DELIVER_TASK_SLUG,
    } as Parameters<typeof payload.jobs.queue>[0])

    await afterCommit(req, () => {
      // Not awaited: the write that triggered this must not wait on the remote service.
      void payload.jobs.runByID({ id: job.id }).catch(() => {
        // Left in the queue; the jobs runner will retry it.
      })
    })
  }
}
