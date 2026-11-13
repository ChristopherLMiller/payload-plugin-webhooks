'use client'

import { useDocumentInfo } from '@payloadcms/ui'

import { cell, code, heading, muted, panel, table } from './styles.js'

const recipes: { auth: string; site: string; url: React.ReactNode }[] = [
  {
    auth: 'None — the webhook id in the URL is the secret, so keep it private.',
    site: 'Home Assistant',
    url: (
      <>
        Create an automation with a <b>Webhook</b> trigger and copy its webhook id. URL:{' '}
        <span style={code}>https://&lt;your-ha&gt;/api/webhook/&lt;webhook_id&gt;</span>. If Payload
        is not on the same network, turn off <i>Only accessible from the local network</i> on the
        trigger. The body is available as <span style={code}>trigger.json</span>.
      </>
    ),
  },
  {
    auth: 'None',
    site: 'Zapier',
    url: (
      <>
        Trigger <b>Webhooks by Zapier → Catch Hook</b>, then copy the webhook URL.
      </>
    ),
  },
  {
    auth: 'None (or a custom header if you add an API key to the webhook)',
    site: 'Make',
    url: (
      <>
        Add <b>Webhooks → Custom webhook</b>, then copy the address.
      </>
    ),
  },
  {
    auth: 'Match the node’s Authentication setting: none, Basic, or Custom header ("Header Auth")',
    site: 'n8n',
    url: (
      <>
        Add a <b>Webhook</b> node with HTTP method POST and use its <b>Production URL</b> (the
        workflow must be active).
      </>
    ),
  },
  {
    auth: 'None (the key is in the URL)',
    site: 'IFTTT',
    url: (
      <>
        <b>Webhooks → Receive a web request with a JSON payload</b>. URL:{' '}
        <span style={code}>
          https://maker.ifttt.com/trigger/&lt;event&gt;/json/with/key/&lt;key&gt;
        </span>
      </>
    ),
  },
  {
    auth: 'Whatever it expects. Add a signing secret and verify the X-Webhook-Signature header.',
    site: 'Your own API',
    url: 'Any URL that accepts a JSON request.',
  },
]

export const EndpointSetupGuide = () => {
  const { id } = useDocumentInfo()

  return (
    <details open={!id} style={panel}>
      <summary style={{ ...heading, cursor: 'pointer', marginBottom: 0 }}>
        How to set up a webhook
      </summary>

      <ol style={{ margin: 'calc(var(--base) * 0.75) 0', paddingLeft: '1.25rem' }}>
        <li>
          On the other site, create an incoming webhook and copy its <b>URL</b> (see the table
          below), then paste it here.
        </li>
        <li>
          Under <b>Events</b>, pick the collections and the kinds of change that should send a
          request.
        </li>
        <li>
          Set <b>Authentication</b> only if the other site asks for a token, password or API key.
        </li>
        <li>
          In the sidebar, choose <b>Run as</b>: the request only contains what that user can read.
          For external sites, use a dedicated user with limited access.
        </li>
        <li>
          <b>Save</b>, then press <b>Send test request</b> in the sidebar. The result shows there,
          and every request is listed under the <b>Delivery log</b> tab.
        </li>
      </ol>

      <table style={table}>
        <thead>
          <tr>
            <th style={{ ...cell, borderTop: 'none', width: '15%' }}>Site</th>
            <th style={{ ...cell, borderTop: 'none' }}>Where to get the URL</th>
            <th style={{ ...cell, borderTop: 'none', width: '28%' }}>Authentication</th>
          </tr>
        </thead>
        <tbody>
          {recipes.map((recipe) => (
            <tr key={recipe.site}>
              <td style={{ ...cell, fontWeight: 600 }}>{recipe.site}</td>
              <td style={cell}>{recipe.url}</td>
              <td style={cell}>{recipe.auth}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ ...muted, margin: 'calc(var(--base) * 0.75) 0 0' }}>
        <b>Slack, Discord and Microsoft Teams</b> only accept their own message format, so they
        reject these requests (HTTP 400). Send to a relay such as n8n, Zapier, Make or Home
        Assistant and post the message from there. Failed requests are retried automatically with
        increasing delays.
      </p>
    </details>
  )
}
