import type { Payload, PayloadRequest } from 'payload'

import { type WebhookEvent, webhookEventEmitter } from './webhookEventEmitter.js'

type TransactionID = number | string
type Callback = () => Promise<void> | void

/**
 * Work deferred until a database transaction commits.
 * Collection `afterChange` / `afterDelete` hooks run *before* Payload commits, so acting
 * from the hook directly would announce changes that may still be rolled back, and
 * anything reading the document from outside the transaction might not see it yet.
 */
const pendingByTransaction = new Map<TransactionID, Callback[]>()

const patchedAdapters = new WeakSet<object>()

const resolveTransactionID = async (
  transactionID: PayloadRequest['transactionID'],
): Promise<null | TransactionID> => {
  const resolved = transactionID instanceof Promise ? await transactionID : transactionID
  return resolved === undefined || resolved === null ? null : resolved
}

const runSafely = async (callback: Callback) => {
  try {
    await callback()
  } catch (_error) {
    // After-commit work must never fail the operation that already committed.
  }
}

/**
 * Run `callback` once the request's transaction commits, or right away if it has none.
 * Dropped if the transaction rolls back.
 */
export const afterCommit = async (req: PayloadRequest, callback: Callback): Promise<void> => {
  const transactionID = await resolveTransactionID(req.transactionID)

  if (transactionID === null) {
    await runSafely(callback)
    return
  }

  const queue = pendingByTransaction.get(transactionID)
  if (queue) {
    queue.push(callback)
  } else {
    pendingByTransaction.set(transactionID, [callback])
  }
}

/**
 * Emit a stream event now if the request has no transaction, otherwise after it commits.
 */
export const queueWebhookEvent = (req: PayloadRequest, event: WebhookEvent): Promise<void> =>
  afterCommit(req, () => {
    webhookEventEmitter.emitWebhook(event)
  })

/**
 * Wrap the database adapter's commit/rollback so deferred work runs after a successful
 * commit and is discarded on rollback. Payload has no public after-commit hook.
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

      const callbacks = pendingByTransaction.get(transactionID)
      pendingByTransaction.delete(transactionID)
      for (const callback of callbacks ?? []) {
        await runSafely(callback)
      }
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
