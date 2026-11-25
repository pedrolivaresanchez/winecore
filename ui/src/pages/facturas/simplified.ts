/** Factura simplificada de CVPO, la que la bodega llama «Venta bodega». */

export const CELLAR_BADGE = 'Venta bodega'

const RETAIL = new Set(['web', 'cellar_shop', 'cellar_sales'])

export function prefersSimplified(input: {
  entityCode: string | null | undefined
  kind: string | null | undefined
  taxId: string | null | undefined
  channel?: string | null
}): boolean {
  if (input.entityCode !== 'CVPO' || input.kind !== 'person') return false
  const tax = input.taxId?.trim() ?? ''
  if (tax !== '') return false
  if (input.channel == null) return true
  return RETAIL.has(input.channel)
}

export function cellarQuarters(now = new Date()): { value: string; label: string }[] {
  const year = madridYear(now)
  const out: { value: string; label: string }[] = []
  for (const value of [year, year - 1]) {
    for (let quarter = 4; quarter >= 1; quarter -= 1) {
      out.push({ value: `${value}-Q${quarter}`, label: `${value} T${quarter}` })
    }
  }
  return out
}

export function quarterBounds(period: string): { from: string; to: string } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(period)
  if (!match?.[1] || !match[2]) return null
  const year = Number(match[1])
  const quarter = Number(match[2])
  const start = (quarter - 1) * 3 + 1
  const end = start + 2
  return {
    from: `${match[1]}-${pad(start)}-01`,
    to: `${match[1]}-${pad(end)}-${daysInMonth(year, end)}`,
  }
}

function madridYear(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric' }).formatToParts(now)
  return Number(parts.find((part) => part.type === 'year')?.value ?? now.getFullYear())
}

function pad(month: number): string {
  return String(month).padStart(2, '0')
}

function daysInMonth(year: number, month: number): string {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return String(days[month - 1] ?? 30)
}
