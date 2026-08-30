import type { PayloadHandler } from 'payload'

import { defaultStreamAuth, type StreamAuth } from '../auth/defaultStreamAuth.js'
import { webhookEventEmitter, type WebhookPayload } from '../hooks/webhookEventEmitter.js'

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

    let pingInterval: NodeJS.Timeout | null = null
    let sendEvent: ((data: WebhookPayload) => void) | null = null

    const stream = new ReadableStream({
      cancel() {
        // Handle stream cancellation
        if (pingInterval) {
          clearInterval(pingInterval)
          pingInterval = null
        }
        if (sendEvent) {
          webhookEventEmitter.removeListener('webhook', sendEvent)
          sendEvent = null
        }
      },
      start(controller) {
        const encoder = new TextEncoder()

        // Send initial connection message
        sendEvent = (data: WebhookPayload) => {
          try {
            const message = `data: ${JSON.stringify(data)}\n\n`
            controller.enqueue(encoder.encode(message))
          } catch (_error) {
            // Client disconnected or stream closed
            cleanup()
          }
        }

        // Send a ping message to keep connection alive
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
          } catch (_error) {
            // Client disconnected
            cleanup()
          }
        }, 30000) // Send ping every 30 seconds

        // Cleanup function
        const cleanup = () => {
          if (pingInterval) {
            clearInterval(pingInterval)
            pingInterval = null
          }
          if (sendEvent) {
            webhookEventEmitter.removeListener('webhook', sendEvent)
            sendEvent = null
          }
          try {
            controller.close()
          } catch (_error) {
            // Stream already closed
          }
        }

        // Listen for webhook events
        if (sendEvent) {
          webhookEventEmitter.on('webhook', sendEvent)
        }

        // Clean up on client disconnect - safely check for signal
        if (
          req &&
          typeof req === 'object' &&
          'signal' in req &&
          req.signal instanceof AbortSignal
        ) {
          req.signal.addEventListener('abort', cleanup)
        }

        // Send initial connection established message
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'connected', message: 'Webhook stream connected' })}\n\n`,
            ),
          )
        } catch (_error) {
          cleanup()
        }
      },
    })

    return new Response(stream, { headers })
  }
}
