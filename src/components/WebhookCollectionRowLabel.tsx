'use client'

import { useConfig, useRowLabel } from '@payloadcms/ui'

type RowData = {
  collection?: string
}

export const WebhookCollectionRowLabel = () => {
  const { data, rowNumber } = useRowLabel<RowData>()
  const { config } = useConfig()

  // Get the collection label from config
  const getCollectionLabel = (slug: string): string => {
    const collection = config?.collections?.find((col) => col.slug === slug)
    if (!collection) {
      return slug.charAt(0).toUpperCase() + slug.slice(1)
    }

    const singularLabel = collection.labels?.singular
    if (typeof singularLabel === 'string') {
      return singularLabel
    }
    if (typeof singularLabel === 'object') {
      return singularLabel.en || singularLabel[''] || slug
    }

    return slug.charAt(0).toUpperCase() + slug.slice(1)
  }

  const collectionSlug = data?.collection
  const collectionLabel = collectionSlug ? getCollectionLabel(collectionSlug) : 'New Collection'

  return <div>{collectionLabel || `Collection ${rowNumber}`}</div>
}
