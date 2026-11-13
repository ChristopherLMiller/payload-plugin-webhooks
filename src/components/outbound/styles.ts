import type { CSSProperties } from 'react'

export const panel: CSSProperties = {
  background: 'var(--theme-elevation-50)',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-m, 4px)',
  marginBottom: 'calc(var(--base) * 1.5)',
  padding: 'calc(var(--base) * 0.75) var(--base)',
}

export const heading: CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  margin: '0 0 calc(var(--base) * 0.5)',
}

export const muted: CSSProperties = {
  color: 'var(--theme-elevation-600)',
}

export const code: CSSProperties = {
  background: 'var(--theme-elevation-100)',
  borderRadius: '3px',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.85em',
  padding: '0 4px',
}

export const pre: CSSProperties = {
  background: 'var(--theme-elevation-100)',
  borderRadius: 'var(--style-radius-s, 3px)',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.8rem',
  lineHeight: 1.5,
  margin: 0,
  overflowX: 'auto',
  padding: 'calc(var(--base) * 0.5)',
  whiteSpace: 'pre',
}

export const table: CSSProperties = {
  borderCollapse: 'collapse',
  fontSize: '0.85rem',
  width: '100%',
}

export const cell: CSSProperties = {
  borderTop: '1px solid var(--theme-elevation-150)',
  padding: '6px 8px 6px 0',
  textAlign: 'left',
  verticalAlign: 'top',
}
