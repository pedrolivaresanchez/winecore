import { createElement, type ReactNode } from 'react'
import { copy } from '@/i18n'
import { COUNTRIES } from '@/lib/contacts'
import { asRecord } from '@/lib/sales'

/** The address a document is sent to, as the API stores it (`ship_to`). All of it is optional. */
export type ShipToDraft = {
  name: string
  line1: string
  line2: string
  postal_code: string
  city: string
  province: string
  country_code: string
}

const KEYS = ['name', 'line1', 'line2', 'postal_code', 'city', 'province', 'country_code'] as const

export function emptyShipTo(): ShipToDraft {
  return { name: '', line1: '', line2: '', postal_code: '', city: '', province: '', country_code: '' }
}

export function shipToDraftOf(value: unknown): ShipToDraft {
  const record = asRecord(value)
  const draft = emptyShipTo()
  if (!record) return draft
  for (const key of KEYS) {
    const raw = record[key]
    if (typeof raw === 'string') draft[key] = key === 'country_code' ? raw.toUpperCase() : raw
  }
  return draft
}

/** `null` when nothing was typed, which is how the API clears the address. */
export function shipToPayload(draft: ShipToDraft): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const key of KEYS) {
    const text = draft[key].trim()
    if (text !== '') out[key] = key === 'country_code' ? text.toUpperCase() : text
  }
  return Object.keys(out).length === 0 ? null : out
}

export function referencesPayload(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

export function hasShipTo(draft: ShipToDraft): boolean {
  return shipToPayload(draft) !== null
}

/** The customer's references, for the read-only view of a document. */
export function referencesLines(text: string | null | undefined): string[] {
  return (text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== '')
}

/** One printable line per part of the address, for the read-only view of a document. */
export function shipToLines(value: unknown): string[] {
  const draft = shipToDraftOf(value)
  const town = [draft.postal_code, draft.city].filter((part) => part.trim() !== '').join(' ')
  const countryName = COUNTRIES.find((country) => country.code === draft.country_code)?.label ?? draft.country_code
  return [draft.name, draft.line1, draft.line2, town, draft.province, countryName].map((line) => line.trim()).filter((line) => line !== '')
}

/** Rows for a document's read-only fact list: only the ones that have something to say. */
export function shippingRows(shipTo: unknown, references: string | null | undefined): { label: string; value: ReactNode }[] {
  const rows: { label: string; value: ReactNode }[] = []
  const address = shipToLines(shipTo)
  if (address.length > 0) rows.push({ label: copy.shipping.address, value: createElement('span', { className: 'block whitespace-pre-line' }, address.join('\n')) })
  const lines = referencesLines(references)
  if (lines.length > 0) rows.push({ label: copy.shipping.references, value: createElement('span', { className: 'block whitespace-pre-line' }, lines.join('\n')) })
  return rows
}
