import { copy } from '@/i18n'
import type { BadgeTone } from '@/ui'
import type { ConfidenceKey } from '@/pages/gastos/types'

export const CATEGORIES: { code: string; account: string; organic: boolean }[] = [
  { code: 'grapes', account: '601', organic: true },
  { code: 'bulk_wine', account: '600', organic: true },
  { code: 'oenological', account: '602', organic: true },
  { code: 'vineyard_inputs', account: '602', organic: true },
  { code: 'cleaning', account: '602', organic: true },
  { code: 'packaging', account: '602', organic: false },
  { code: 'goods_for_resale', account: '600', organic: false },
  { code: 'transport', account: '624', organic: false },
  { code: 'warehousing', account: '621', organic: false },
  { code: 'rent', account: '621', organic: false },
  { code: 'utilities', account: '628', organic: false },
  { code: 'marketing', account: '627', organic: false },
  { code: 'software', account: '629', organic: false },
  { code: 'professional', account: '623', organic: false },
  { code: 'lab', account: '623', organic: false },
  { code: 'other_services', account: '629', organic: false },
]

const STATUS_TONE: Record<string, BadgeTone> = {
  captured: 'info',
  validated: 'warning',
  approved: 'success',
  rejected: 'danger',
  duplicate: 'warning',
}

export function statusLabel(status: string): string {
  const table = copy.gastos.statuses as Record<string, string>
  return table[status] ?? status
}

export function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status] ?? 'neutral'
}

export function categoryLabel(code: string | null | undefined): string {
  if (!code) return '—'
  const table = copy.gastos.categories as Record<string, string>
  return table[code] ?? code
}

export function accountFor(code: string | null | undefined): string | null {
  return CATEGORIES.find((item) => item.code === code)?.account ?? null
}

export function paymentLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const table = copy.gastos.payments as Record<string, string>
  return table[value] ?? value
}

export function confidenceLow(value: number | undefined): boolean {
  return typeof value === 'number' && value < 0.8
}

export function confidenceMark(key: ConfidenceKey, map: Partial<Record<ConfidenceKey, number>>): string | undefined {
  const value = map[key]
  if (!confidenceLow(value) || value == null) return undefined
  return `${Math.round(value * 100)} %`
}

export function monthOptions(now = new Date()): { value: string; label: string }[] {
  const cursor = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  const format = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const options: { value: string; label: string }[] = []
  for (let index = 0; index < 18; index += 1) {
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0')
    options.push({
      value: `${cursor.getUTCFullYear()}-${month}`,
      label: format.format(cursor).replace('.', ''),
    })
    cursor.setUTCMonth(cursor.getUTCMonth() - 1)
  }
  return options
}

export function quarterOf(month: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const quarter = Math.floor((Number(match[2]) - 1) / 3) + 1
  return `${match[1]}-T${quarter}`
}

export function currentQuarter(now = new Date()): string {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return quarterOf(month) ?? `${now.getFullYear()}-T1`
}
