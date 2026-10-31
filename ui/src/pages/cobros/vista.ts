import { copy } from '@/i18n'

export type Vista = 'pendiente' | 'pagos' | 'conciliacion' | 'remesas'

export const VISTAS: { id: Vista; label: string }[] = [
  { id: 'pendiente', label: copy.cobros.views.pendiente },
  { id: 'pagos', label: copy.cobros.views.pagos },
  { id: 'conciliacion', label: copy.cobros.views.conciliacion },
  { id: 'remesas', label: copy.cobros.views.remesas },
]

export function vistaOf(raw: string | null): Vista {
  if (raw === 'pagos' || raw === 'conciliacion' || raw === 'remesas') return raw
  return 'pendiente'
}
