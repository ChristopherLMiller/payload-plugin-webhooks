import type { Payload, PayloadRequest } from 'payload'

import { type WebhookEvent, webhookEventEmitter } from './webhookEventEmitter.js'

type TransactionID = number | string

/**
 * Events raised inside a database transaction, held until that transaction commits.
 * Collection `afterChange` / `afterDelete` hooks run *before* Payload commits, so emitting
 * from the hook directly would announce changes that may still be rolled back, and
 * subscribers re-reading the document might not see it yet.
 */
const pendingByTransaction = new Map<TransactionID, WebhookEvent[]>()

const patchedAdapters = new WeakSet<object>()

const resolveTransactionID = async (
  transactionID: PayloadRequest['transactionID'],
): Promise<null | TransactionID> => {
  const resolved = transactionID instanceof Promise ? await transactionID : transactionID
  return resolved === undefined || resolved === null ? null : resolved
}

/**
 * Emit now if the request has no transaction, otherwise defer until it commits.
 */
export const queueWebhookEvent = async (
  req: PayloadRequest,
  event: WebhookEvent,
): Promise<void> => {
  const transactionID = await resolveTransactionID(req.transactionID)

  if (transactionID === null) {
    webhookEventEmitter.emitWebhook(event)
    return
  }

  const queue = pendingByTransaction.get(transactionID)
  if (queue) {
    queue.push(event)
  } else {
    pendingByTransaction.set(transactionID, [event])
  }
}

/**
 * Wrap the database adapter's commit/rollback so queued events are flushed after a
 * successful commit and discarded on rollback. Payload has no public after-commit hook.
 */
export const installTransactionHooks = (payload: Payload): void => {
  const db = payload.db

  if (!db || patchedAdapters.has(db)) {
    return
  }
  patchedAdapters.add(db)

  const originalCommit = db.commitTransaction
  const originalRollback = db.rollbackTransaction

  if (typeof originalCommit === 'function') {
    db.commitTransaction = async (id) => {
      await originalCommit.call(db, id)

      const transactionID = await resolveTransactionID(id)
      if (transactionID === null) {
        return
      }

      const events = pendingByTransaction.get(transactionID)
      pendingByTransaction.delete(transactionID)
      events?.forEach((event) => webhookEventEmitter.emitWebhook(event))
    }
  }

  if (typeof originalRollback === 'function') {
    db.rollbackTransaction = async (id) => {
      const transactionID = await resolveTransactionID(id)
      if (transactionID !== null) {
        pendingByTransaction.delete(transactionID)
      }

      return originalRollback.call(db, id)
    }
  }
}
