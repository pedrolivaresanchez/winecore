import { money } from '@/pages/facturas/format'

export type HoldedLine = {
  line_no: number
  sku: string
  description: string
  quantity: string
  unit_price: string
  line_base: string
  tax_code: string
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function linesOf(payload: unknown): HoldedLine[] {
  if (!payload || typeof payload !== 'object') return []
  const raw = (payload as { lines?: unknown }).lines
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const parsed = typeof row.line_no === 'number' ? row.line_no : Number(row.line_no)
    return [{
      line_no: Number.isFinite(parsed) ? parsed : index + 1,
      sku: asText(row.sku),
      description: asText(row.description),
      quantity: asText(row.quantity),
      unit_price: asText(row.unit_price),
      line_base: asText(row.line_base),
      tax_code: asText(row.tax_code),
    }]
  })
}

function centsOf(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(2) : '') : value.trim().replace(',', '.')
  if (!text) return 0
  const negative = text.startsWith('-')
  const raw = negative ? text.slice(1) : text
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!match) return 0
  const whole = Number(match[1])
  const frac = `${match[2] ?? ''}000`
  let cents = whole * 100 + Number(frac.slice(0, 2))
  if (frac[2] >= '5') cents += 1
  return negative ? -cents : cents
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Suma en céntimos enteros. `money()` no parte céntimos, así que el total no pasa por un float. */
export function moneySum(values: Array<string | number | null | undefined>): string {
  let cents = 0
  for (const value of values) cents += centsOf(value)
  return money(fromCents(cents))
}
