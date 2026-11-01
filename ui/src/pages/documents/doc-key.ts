import type { DocSource } from '@/pages/documents/sources'

/** A document opened in the document modal, kept in `?doc=<source>:<id>`. */
export type RecordDoc = { source: DocSource; id: string }

const MODAL_SOURCES: readonly DocSource[] = ['holded-invoice', 'holded-document', 'invoice', 'quote', 'order', 'delivery']

export function docKey(doc: RecordDoc): string {
  return `${doc.source}:${doc.id}`
}

export function parseDocKey(value: string | null): RecordDoc | null {
  if (!value) return null
  const cut = value.indexOf(':')
  if (cut <= 0) return null
  const source = value.slice(0, cut) as DocSource
  const id = value.slice(cut + 1)
  return MODAL_SOURCES.includes(source) && id ? { source, id } : null
}
