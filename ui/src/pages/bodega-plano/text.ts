import { copy } from '@/i18n'
import type { BarrelStatus, HolderKind, OakOrigin, ToastLevel, ZoneKind } from '@/pages/bodega-plano/types'

export const ZONE_ORDER = ['elaboration', 'barrel_room', 'outdoor', 'bottle_store'] as const

const ZONE_LABEL: Record<string, string> = {
  elaboration: copy.plano.elaboration,
  barrel_room: copy.plano.barrelRoom,
  outdoor: copy.plano.outdoorZone,
  bottle_store: copy.plano.bottleStore,
  other: copy.plano.other,
}

const OAK_LABEL: Record<OakOrigin, string> = {
  frances: copy.plano.frances,
  americano: copy.plano.americano,
  centroeuropeo: copy.plano.centroeuropeo,
  otro: copy.plano.otro,
}

const TOAST_LABEL: Record<ToastLevel, string> = {
  ligero: copy.plano.ligero,
  medio: copy.plano.medio,
  medio_plus: copy.plano.medioPlus,
  fuerte: copy.plano.fuerte,
}

const BARREL_STATUS: Record<BarrelStatus, string> = {
  in_use: copy.plano.inUse,
  resting: copy.plano.resting,
  to_retire: copy.plano.toRetire,
  retired: copy.plano.retired,
}

export const OAK_ORIGINS: OakOrigin[] = ['frances', 'americano', 'centroeuropeo', 'otro']
export const TOAST_LEVELS: ToastLevel[] = ['ligero', 'medio', 'medio_plus', 'fuerte']
export const BARREL_STATUSES: BarrelStatus[] = ['in_use', 'resting', 'to_retire', 'retired']

export function isZoneKind(value: string): value is ZoneKind {
  return value === 'elaboration' || value === 'barrel_room' || value === 'outdoor' || value === 'bottle_store' || value === 'other'
}

export function zoneLabel(kind: string): string {
  return ZONE_LABEL[kind] ?? kind
}

export function oakLabel(origin: OakOrigin): string {
  return OAK_LABEL[origin]
}

export function toastLabel(level: ToastLevel): string {
  return TOAST_LABEL[level]
}

export function barrelStatusLabel(status: BarrelStatus): string {
  return BARREL_STATUS[status]
}

export function holderKindLabel(kind: HolderKind | string): string {
  if (kind === 'jaulon') return copy.plano.kindJaulon
  if (kind === 'nicho') return copy.plano.kindNicho
  return kind
}

export function packagedLabel(state: string | null): string {
  if (state === 'packaged_unlabeled') return copy.plano.unlabeled
  if (state === 'packaged_labeled') return copy.plano.labeled
  if (state === 'mixed') return copy.plano.mixed
  if (!state || state === 'empty') return copy.plano.empty
  return state
}

export type VesselTabId =
  | 'contenido'
  | 'barrica'
  | 'damajuana'
  | 'lecturas'
  | 'analiticas'
  | 'limpiezas'
  | 'historial'
  | 'qr'

export function vesselTabs(kind: string): { id: VesselTabId; label: string }[] {
  const extra: { id: VesselTabId; label: string }[] =
    kind === 'barrel'
      ? [{ id: 'barrica', label: copy.plano.barrelTab }]
      : kind === 'demijohn'
        ? [{ id: 'damajuana', label: copy.plano.demijohnTab }]
        : []
  return [
    { id: 'contenido', label: copy.cellar.content },
    ...extra,
    { id: 'lecturas', label: copy.cellar.readings },
    { id: 'analiticas', label: copy.cellar.analyses },
    { id: 'limpiezas', label: copy.cellar.cleanings },
    { id: 'historial', label: copy.cellar.history },
    { id: 'qr', label: copy.cellar.qr },
  ]
}
