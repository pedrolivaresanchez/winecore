import { api } from '@/lib/api'
import type { BarrelStatus, BarrelView, DemijohnView, Geom, HolderView, OakOrigin, ToastLevel } from '@/pages/bodega-plano/types'

export function patchPosition(zoneCode: string, positionId: string, geom: Geom) {
  return api<Geom>(`/v1/cellar-zones/${encodeURIComponent(zoneCode)}/positions/${encodeURIComponent(positionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(geom),
  })
}

export function deletePosition(zoneCode: string, positionId: string) {
  return api<{ id: string; deleted: true; vessel_code: string | null; holder_code: string | null }>(
    `/v1/cellar-zones/${encodeURIComponent(zoneCode)}/positions/${encodeURIComponent(positionId)}`,
    { method: 'DELETE' },
  )
}

export function createZone(body: { location_id: string; code: string; name: string; kind: string }) {
  return api<unknown>('/v1/cellar-zones', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createPosition(
  zoneCode: string,
  subject: { vessel_code?: string; holder_code?: string },
  geom: Geom,
) {
  return api<unknown>(`/v1/cellar-zones/${encodeURIComponent(zoneCode)}/positions`, {
    method: 'POST',
    body: JSON.stringify({ ...subject, ...geom }),
  })
}

export type BarrelBody = {
  oak_origin: OakOrigin
  forest: string | null
  toast: ToastLevel
  head_toast: boolean
  cooper: string
  year_made: number
  nominal_volume_ml: number
  status?: BarrelStatus
  retired_on?: string | null
}

export function createBarrel(code: string, body: BarrelBody) {
  return api<BarrelView>(`/v1/vessels/${encodeURIComponent(code)}/barrel`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function patchBarrel(code: string, body: Partial<BarrelBody>) {
  return api<BarrelView>(`/v1/vessels/${encodeURIComponent(code)}/barrel`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function saveDemijohn(code: string, outdoor: boolean) {
  return api<DemijohnView>(`/v1/vessels/${encodeURIComponent(code)}/demijohn`, {
    method: 'PUT',
    body: JSON.stringify({ outdoor_aging: outdoor }),
  })
}

export function postHolderMove(
  code: string,
  body: {
    occurred_at: string
    owner_entity_id: string
    lot_id: string
    product_id: string
    product_state: 'packaged_unlabeled' | 'packaged_labeled'
    qty_units: number
  },
) {
  return api<HolderView>(`/v1/holders/${encodeURIComponent(code)}/moves`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function attachmentUrl(id: string): Promise<string> {
  const response = await fetch(`/api/v1/attachments/${encodeURIComponent(id)}`, {
    headers: { Accept: '*/*' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('attachment')
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
