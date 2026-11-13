import type { FieldHook, TextField } from 'payload'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** Shown in the admin panel / API in place of a stored secret. */
export const SECRET_MASK = '••••••••'

/** `req.context` flag that makes secret fields return their decrypted value. */
export const REVEAL_SECRETS_CONTEXT_KEY = 'payloadPluginWebhooksRevealSecrets'

const PREFIX = 'enc:v1:'

const keyFrom = (secret: string) => createHash('sha256').update(secret).digest()

export const encryptSecret = (value: string, secret: string): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export const decryptSecret = (stored: string, secret: string): string => {
  if (!stored.startsWith(PREFIX)) {
    return stored
  }
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
}

const makeBeforeChange =
  (name: string): FieldHook =>
  ({ req, siblingDocWithLocales, value }) => {
    // The admin form submits the mask back unchanged: keep whatever is stored. Use the raw
    // stored sibling doc, not `originalDoc`, which has already been masked by afterRead.
    if (value === SECRET_MASK) {
      return siblingDocWithLocales?.[name]
    }
    if (typeof value !== 'string' || value === '') {
      return value
    }
    return encryptSecret(value, req.payload.secret)
  }

const afterRead: FieldHook = ({ req, value }) => {
  if (typeof value !== 'string' || value === '') {
    return value
  }
  if (req.context?.[REVEAL_SECRETS_CONTEXT_KEY]) {
    try {
      return decryptSecret(value, req.payload.secret)
    } catch (_error) {
      // PAYLOAD_SECRET changed since this was saved; the value can't be recovered.
      return undefined
    }
  }
  return SECRET_MASK
}

/**
 * A text field whose value is encrypted at rest with the Payload secret and masked
 * everywhere it is read, except by the plugin's own delivery code.
 */
export const secretField = ({
  name,
  condition,
  description,
  label,
}: {
  condition?: NonNullable<TextField['admin']>['condition']
  description?: string
  label: string
  name: string
}): TextField => ({
  name,
  type: 'text',
  admin: {
    condition,
    description: [description, 'Stored encrypted; shown masked after saving.']
      .filter(Boolean)
      .join(' '),
  },
  hooks: {
    afterRead: [afterRead],
    beforeChange: [makeBeforeChange(name)],
  },
  label,
})
