import { copy } from '@/i18n'
import type { Me } from '@/lib/types'

export const TARGET_CODES = [
  'molecular_so2_tinto_mg_l',
  'molecular_so2_blanco_mg_l',
  'molecular_so2_rosado_mg_l',
  'density_alcohol_factor',
] as const

export const THRESHOLD_CODES = [
  'volatile_acidity_alert_g_l',
  'volatile_acidity_legal_max_g_l',
  'dryness_glucose_fructose_g_l',
  'malolactic_malic_g_l',
  'pre_bottling_freshness_days',
  'bottling_analysis_mode',
  'winter_racking_month_from',
  'winter_racking_month_to',
  'bottling_reminder_month_from',
  'bottling_reminder_month_to',
] as const

export const NULLABLE_CODES = new Set(['volatile_acidity_legal_max_g_l'])
export const TEXT_CODES = new Set(['bottling_analysis_mode'])

export function parameterLabel(code: string): string {
  if (code in copy.enology.params) return copy.enology.params[code as keyof typeof copy.enology.params]
  return code
}

export function processLabel(process: string): string {
  if (process in copy.enology.process) return copy.enology.process[process as keyof typeof copy.enology.process]
  return process
}

export function stateLabel(state: string): string {
  if (state in copy.enology.state) return copy.enology.state[state as keyof typeof copy.enology.state]
  return state
}

export function wineLabel(color: string): string {
  if (color in copy.enology.wine) return copy.enology.wine[color as keyof typeof copy.enology.wine]
  return color
}

export function sugarLabel(band: string): string {
  if (band in copy.enology.sugar) return copy.enology.sugar[band as keyof typeof copy.enology.sugar]
  return band
}

export function unitSuffix(unit: string | null): string | null {
  if (unit === 'mg/L') return copy.enology.units.mgL
  if (unit === 'g/L') return copy.enology.units.gL
  if (unit === 'd') return copy.enology.units.days
  if (unit === 'mes') return copy.enology.units.month
  return null
}

export function entityShort(code: string): string {
  if (code === 'PO') return copy.entity.po
  if (code === 'CVPO') return copy.entity.cvpo
  return code
}

/** Ajustes de enología: solo las bodegas de las que esta cuenta es propietaria. */
export function ownedEntities(me: Me): Me['entities'] {
  const global = me.roles.some((role) => role.role === 'owner' && role.legal_entity_code == null)
  if (global) return me.entities
  const codes = new Set(
    me.roles.flatMap((role) => (role.role === 'owner' && role.legal_entity_code ? [role.legal_entity_code] : [])),
  )
  return me.entities.filter((entity) => codes.has(entity.code))
}
