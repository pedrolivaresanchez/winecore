import { copy, fill } from '@/i18n'
import type { Me } from '@/lib/types'
import { entityLabel } from '@/pages/facturas/format'
import type { NumberingNeed } from './api'

export function canManageNumbering(me: Me): boolean {
  return me.roles.some((role) => role.role === 'owner' || role.role === 'admin')
}

export function docLabel(docType: string): string {
  return (copy.numbering.docs as Record<string, string>)[docType] ?? docType
}

export function firstTitle(need: NumberingNeed): string {
  const doc = (copy.numbering.doc as Record<string, string>)[need.doc_type] ?? copy.numbering.doc.invoice
  return fill(copy.numbering.first, { doc, entity: entityLabel(need.entity_code), year: String(need.year) })
}
