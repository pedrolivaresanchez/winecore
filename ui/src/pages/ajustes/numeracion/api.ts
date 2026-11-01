import { api } from '@/lib/api'

export type FiscalDoc = 'invoice' | 'credit_note' | 'simplified_invoice'

export const FISCAL_DOCS: FiscalDoc[] = ['invoice', 'credit_note', 'simplified_invoice']

/** What the API reports when a draft is issued before its entity has a series for the year. */
export type NumberingNeed = {
  legal_entity_id: string
  entity_code: string
  doc_type: string
  year: number
}

export type NumberingOption = {
  code: string
  prefix: string
  padding: number
  next_value: number
  verifactu: boolean
  first_number: string
  limit_number: string
}

export type NumberingProposal = NumberingNeed & {
  active: { id: string; prefix: string; next_number: string } | null
  fresh: NumberingOption
  holded: (NumberingOption & { last_number: string; last_date: string; last_year: number; count: number }) | null
}

export type Series = {
  id: string
  legal_entity_id: string
  doc_type: string
  code: string
  year: number
  prefix: string
  padding: number
  next_value: number
  last_number: string | null
  is_default: boolean
  verifactu: boolean
  is_active: boolean
}

export type LegalEntity = {
  id: string
  code: string
  legal_name: string
  tax_id: string
  person_type: string
  address_line: string
  postal_code: string
  city: string
  province: string
  country_code: string
  eori: string | null
}

export function numberingNeed(details: unknown): NumberingNeed | null {
  if (!details || typeof details !== 'object') return null
  const row = details as Record<string, unknown>
  if (typeof row.legal_entity_id !== 'string' || typeof row.doc_type !== 'string' || typeof row.year !== 'number') return null
  return {
    legal_entity_id: row.legal_entity_id,
    entity_code: typeof row.entity_code === 'string' ? row.entity_code : '',
    doc_type: row.doc_type,
    year: row.year,
  }
}

export function proposalPath(need: Pick<NumberingNeed, 'legal_entity_id' | 'doc_type' | 'year'>) {
  const params = new URLSearchParams({ legal_entity_id: need.legal_entity_id, doc_type: need.doc_type, year: String(need.year) })
  return `/v1/number-series/proposal?${params}`
}

export function openNumbering(body: NumberingNeed & { choice: 'fresh' | 'holded'; next_value?: number }) {
  return api<Series>('/v1/number-series/open', {
    method: 'POST',
    body: JSON.stringify({
      legal_entity_id: body.legal_entity_id,
      doc_type: body.doc_type,
      year: body.year,
      choice: body.choice,
      next_value: body.next_value,
    }),
  })
}

export function deactivateSeries(id: string) {
  return api<Series>(`/v1/number-series/${encodeURIComponent(id)}/deactivate`, { method: 'POST', body: '{}' })
}

export function patchEntity(code: string, body: Record<string, string | null>) {
  return api<LegalEntity>(`/v1/legal-entities/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
