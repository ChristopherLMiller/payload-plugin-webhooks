'use client'

import { useFormFields } from '@payloadcms/ui'

import { heading, muted, panel, pre } from './styles.js'

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/**
 * Live preview of the request the receiving site will get, built from the form as it is
 * being filled in.
 */
export const RequestPreview = () => {
  const fields = useFormFields(([formFields]) => formFields)
  const value = (path: string): unknown => fields[path]?.value

  const method = asString(value('method')) || 'POST'
  const url = asString(value('url')) || 'https://…'
  const collections = asArray(value('events.collections'))
  const operations = asArray(value('events.operations'))
  const includeDocument = value('includeDocument') !== false
  const authType = asString(value('authentication.type')) || 'none'
  const headerName = asString(value('authentication.headerName'))
  const hasSigningSecret = Boolean(asString(value('signingSecret')))
  const headerRows = Number(value('headers')) || 0

  const collection = collections[0] ?? '<collection>'
  const operation = operations.includes('update') ? 'update' : (operations[0] ?? 'create')
  const eventName = `${collection}.${operation}`

  const headerLines = [`${method} ${url}`, 'Content-Type: application/json']
  if (authType === 'bearer') {
    headerLines.push('Authorization: Bearer <token>')
  } else if (authType === 'basic') {
    headerLines.push('Authorization: Basic <username:password, base64>')
  } else if (authType === 'header') {
    headerLines.push(`${headerName || '<header name>'}: <header value>`)
  }
  for (let i = 0; i < headerRows; i++) {
    const name = asString(value(`headers.${i}.name`))
    if (name) {
      headerLines.push(`${name}: ${asString(value(`headers.${i}.value`))}`)
    }
  }
  headerLines.push(`X-Webhook-Event: ${eventName}`, 'X-Webhook-Delivery: <unique id per request>')
  if (hasSigningSecret) {
    headerLines.push('X-Webhook-Signature: t=<unix time>,v1=<hmac sha256>')
  }

  const body: Record<string, unknown> = {
    id: '<document id>',
    action: operation,
    collection,
    deliveryId: '<unique id per request>',
    event: eventName,
    timestamp: '<ISO 8601 time>',
  }
  if (includeDocument && operation !== 'delete') {
    body.data = { '…': 'the document, with the fields the Run as user can read' }
    if (operation === 'update') {
      body.previousData = { '…': 'the version before this update (same fields)' }
    }
  }

  const events =
    collections.length && operations.length
      ? collections.flatMap((c) => operations.map((o) => `${c}.${o}`)).join(', ')
      : 'none yet. Pick collections and operations under Events.'

  return (
    <div style={panel}>
      <p style={heading}>What the other site receives</p>
      <p style={{ ...muted, margin: '0 0 calc(var(--base) * 0.5)' }}>
        Sent for: <b>{events}</b>
      </p>
      <pre style={pre}>{`${headerLines.join('\n')}\n\n${JSON.stringify(body, null, 2)}`}</pre>
      <p style={{ ...muted, margin: 'calc(var(--base) * 0.5) 0 0' }}>
        Delete events only include the id (no document). In Home Assistant, read values with{' '}
        <code>{'{{ trigger.json.data.<field> }}'}</code> and check{' '}
        <code>{'{{ trigger.json.event }}'}</code> to tell events apart. Use{' '}
        <code>X-Webhook-Delivery</code> to ignore an occasional duplicate.
      </p>
    </div>
  )
}
