'use client'

import React from 'react'

export const ApiKeyCell: React.FC<{ cellData?: string }> = ({ cellData }) => {
  if (!cellData) {
    return <span style={{ color: '#999' }}>Not generated</span>
  }

  return <span style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>••••••••••••••••</span>
}
