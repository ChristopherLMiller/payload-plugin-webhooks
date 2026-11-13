'use client'

import { Button, useConfig, useDocumentInfo, useFormModified } from '@payloadcms/ui'
import { useState } from 'react'

import { muted, pre } from './styles.js'

type TestResult = {
  durationMs?: number
  error?: string
  ok: boolean
  responseBody?: string
  sentBody?: unknown
  status?: number
}

export const SendTestButton = () => {
  const { id } = useDocumentInfo()
  const modified = useFormModified()
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<null | TestResult>(null)

  const send = async () => {
    setSending(true)
    setResult(null)
    try {
      const response = await fetch(`${serverURL}${api}/webhook-endpoints/${id}/test`, {
        credentials: 'include',
        method: 'POST',
      })
      const data = (await response.json()) as TestResult
      setResult(response.ok ? data : { error: data.error ?? `HTTP ${response.status}`, ok: false })
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error), ok: false })
    } finally {
      setSending(false)
    }
  }

  const hint = !id
    ? 'Save the endpoint first, then send a test request.'
    : modified
      ? 'Save your changes first; the test uses the saved settings.'
      : 'Sends a sample request now (with "event": "webhook.test") and shows the response.'

  return (
    <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
      <Button
        buttonStyle="secondary"
        disabled={!id || modified || sending}
        margin={false}
        onClick={() => void send()}
        size="medium"
      >
        {sending ? 'Sending…' : 'Send test request'}
      </Button>
      <p style={{ ...muted, fontSize: '0.8rem', margin: '6px 0 0' }}>{hint}</p>

      {result && (
        <div
          aria-label="Test request result"
          role="status"
          style={{
            borderLeft: `3px solid ${result.ok ? 'var(--theme-success-500)' : 'var(--theme-error-500)'}`,
            marginTop: 'calc(var(--base) * 0.5)',
            paddingLeft: '8px',
          }}
        >
          <p style={{ fontWeight: 600, margin: 0 }}>
            {result.ok
              ? `Delivered — HTTP ${result.status} in ${result.durationMs} ms`
              : `Failed${result.status ? ` — HTTP ${result.status}` : ''}`}
          </p>
          {result.error && <p style={{ margin: '4px 0 0' }}>{result.error}</p>}
          {result.responseBody ? (
            <details style={{ marginTop: '4px' }}>
              <summary style={{ cursor: 'pointer' }}>Response</summary>
              <pre style={pre}>{result.responseBody}</pre>
            </details>
          ) : null}
          {result.sentBody ? (
            <details style={{ marginTop: '4px' }}>
              <summary style={{ cursor: 'pointer' }}>Request body sent</summary>
              <pre style={pre}>{JSON.stringify(result.sentBody, null, 2)}</pre>
            </details>
          ) : null}
        </div>
      )}
    </div>
  )
}
