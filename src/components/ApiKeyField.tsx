'use client'

import type { TextFieldClientProps } from 'payload'
import { useField } from '@payloadcms/ui'
import React, { useCallback, useState } from 'react'

import './styles.css'

export const ApiKeyField: React.FC<TextFieldClientProps> = (props) => {
  const { path, field, readOnly: readOnlyFromProps } = props
  const { value, setValue } = useField<string>({ path })
  const [copied, setCopied] = useState(false)
  const [visible, setVisible] = useState(false)

  const readOnly = readOnlyFromProps || field?.admin?.readOnly

  // Generate a strong random API key using Web Crypto API
  const generateKey = useCallback(() => {
    // Generate 32 random bytes (256 bits)
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)

    // Convert to base64url format (URL-safe)
    const base64 = btoa(String.fromCharCode(...array))
    const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

    setValue(base64url)
  }, [setValue])

  // Copy to clipboard
  const copyToClipboard = useCallback(async () => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value as string)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [value])

  // Helper to get string from label
  const getLabel = () => {
    if (typeof field.label === 'string') return field.label
    if (typeof field.label === 'object' && field.label !== null) {
      return (field.label as Record<string, string>).en || Object.values(field.label)[0] || 'Key'
    }
    return 'Key'
  }

  // Helper to get string from description
  const getDescription = () => {
    const desc = field.admin?.description
    if (typeof desc === 'string') return desc
    if (typeof desc === 'object' && desc !== null) {
      return (desc as Record<string, string>).en || Object.values(desc)[0] || ''
    }
    return ''
  }

  // Get display value (obfuscated or real)
  const displayValue = value && !visible ? '••••••••••••••••••••••••••••••••' : (value as string) || ''

  return (
    <div className="api-key-field-wrapper">
      <div className="field-type text">
        <label className="field-label" htmlFor={`field-${path}`}>
          {getLabel()}
          {field.required && <span className="required">*</span>}
        </label>
        {field.admin?.description && (
          <div className="field-description">{getDescription()}</div>
        )}
        <div className="api-key-input-container">
          <input
            type="text"
            id={`field-${path}`}
            name={path}
            value={displayValue}
            onChange={(e) => {
              if (visible) {
                setValue(e.target.value)
              }
            }}
            readOnly={!visible || readOnly}
            placeholder="Click 'Generate Key' to create a new API key"
            className="api-key-input"
          />
          {value && (
            <button
              type="button"
              className="api-key-toggle-visibility"
              onClick={() => setVisible(!visible)}
              title={visible ? 'Hide key' : 'Show key'}
            >
              {visible ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="16"
                  height="16"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="16"
                  height="16"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          )}
        </div>
        <div className="api-key-actions">
          {!readOnly && (
            <button
              type="button"
              className="btn btn--style-secondary btn--size-small generate-key-btn"
              onClick={generateKey}
            >
              Generate Key
            </button>
          )}
          {value && (
            <button
              type="button"
              className="btn btn--style-secondary btn--size-small copy-key-btn"
              onClick={copyToClipboard}
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
