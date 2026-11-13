import type { PayloadHandler } from 'payload'

import { defaultStreamAuth, type StreamAuth } from '../auth/defaultStreamAuth.js'
import { type WebhookEvent, webhookEventEmitter } from '../hooks/webhookEventEmitter.js'
import { filterEventForSubscriber } from './filterEventForSubscriber.js'

const PING_INTERVAL_MS = 30_000

/**
 * Factory function to create a webhook stream handler with custom authentication
 */
export const createWebhookStreamHandler = (streamAuth?: StreamAuth): PayloadHandler => {
  return async (req) => {
    const authCheck = await (streamAuth ?? defaultStreamAuth)(req)

    if (!authCheck) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 401,
      })
    }

    // Set up Server-Sent Events headers
    const headers = new Headers({
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no', // Disable buffering for nginx
    })

    const subscriber = { payload: req.payload, user: req.user }
    const encoder = new TextEncoder()

    let closed = false
    let pingInterval: NodeJS.Timeout | null = null
    let onWebhook: ((event: WebhookEvent) => void) | null = null

    const cleanup = () => {
      closed = true
      if (pingInterval) {
        clearInterval(pingInterval)
        pingInterval = null
      }
      if (onWebhook) {
        webhookEventEmitter.removeListener('webhook', onWebhook)
        onWebhook = null
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cleanup()
      },
      start(controller) {
        const write = (chunk: string) => {
          if (closed) {
            return
          }
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch (_error) {
            // Client disconnected or stream closed
            cleanup()
            try {
              controller.close()
            } catch (_closeError) {
              // Stream already closed
            }
          }
        }

        // Access filtering is async; chain it so events reach this client in emit order.
        let queue: Promise<void> = Promise.resolve()

        onWebhook = (event) => {
          queue = queue.then(async () => {
            if (closed) {
              return
            }
            const visible = await filterEventForSubscriber(event, subscriber)
            if (visible) {
              write(`data: ${JSON.stringify(visible)}\n\n`)
            }
          })
        }

        webhookEventEmitter.on('webhook', onWebhook)

        // Send a ping comment to keep the connection alive through proxies
        pingInterval = setInterval(() => write(': ping\n\n'), PING_INTERVAL_MS)

        // Clean up on client disconnect
        if (req.signal instanceof AbortSignal) {
          req.signal.addEventListener('abort', cleanup)
        }

        write(
          `data: ${JSON.stringify({ type: 'connected', message: 'Webhook stream connected' })}\n\n`,
        )
      },
    })

    return new Response(stream, { headers })
  }
}
