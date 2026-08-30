import type { PayloadRequest } from 'payload'

export type StreamAuth = (req: PayloadRequest) => boolean | Promise<boolean>

/**
 * Allow the webhook stream when the request is already authenticated, or when any
 * auth strategy registered on the host Payload app accepts the request headers.
 *
 * That covers:
 * - Session cookies / JWT (`req.user`)
 * - Payload native API keys (`auth.useAPIKey`, `Authorization: <slug> API-Key <key>`)
 * - Better Auth (and other custom strategies) when they are registered on an auth collection
 */
export const defaultStreamAuth: StreamAuth = async (req) => {
  if (req.user) {
    return true
  }

  try {
    const { user } = await req.payload.auth({
      headers: req.headers,
    })

    if (user) {
      req.user = user
      return true
    }

    return false
  } catch {
    return false
  }
}
