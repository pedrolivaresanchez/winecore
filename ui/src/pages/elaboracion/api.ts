import { ApiError, api } from '@/lib/api'
import type { Analysis, CurvePoint, Evolution, LotPhase, Page } from '@/pages/elaboracion/model'

function post<T>(path: string, body: unknown) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

export function listReadings(query: { lotId?: string; vesselId?: string }, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (query.lotId) params.set('lotId', query.lotId)
  if (query.vesselId) params.set('vesselId', query.vesselId)
  return api<{ items: CurvePoint[] }>(`/v1/fermentation-readings?${params.toString()}`, { signal })
}

export function createReading(body: {
  lot_id: string
  vessel_id: string
  at: string
  density?: string
  temperature_c?: string
  source: 'manual'
}) {
  return post<Record<string, unknown>>('/v1/fermentation-readings', body)
}

export function fermentationCurve(code: string, signal?: AbortSignal) {
  return api<{ lot_id: string; points: CurvePoint[] }>(`/v1/lots/${encodeURIComponent(code)}/fermentation-curve`, { signal })
}

export function listPhases(code: string, signal?: AbortSignal) {
  return api<Page<LotPhase>>(`/v1/lots/${encodeURIComponent(code)}/phases`, { signal })
}

export function startPhase(code: string, body: unknown) {
  return post<LotPhase>(`/v1/lots/${encodeURIComponent(code)}/phases`, body)
}

export function endPhase(code: string, id: string, body: unknown) {
  return post<LotPhase>(`/v1/lots/${encodeURIComponent(code)}/phases/${encodeURIComponent(id)}/end`, body)
}

export function stopPhase(code: string, id: string, body: unknown) {
  return post<LotPhase>(`/v1/lots/${encodeURIComponent(code)}/phases/${encodeURIComponent(id)}/stop`, body)
}

export function listAnalyses(code: string, signal?: AbortSignal) {
  return api<Page<Analysis>>(`/v1/lots/${encodeURIComponent(code)}/analyses`, { signal })
}

export function createLotAnalysis(code: string, body: unknown) {
  return post<Analysis>(`/v1/lots/${encodeURIComponent(code)}/analyses`, body)
}

export function createParcelAnalysis(code: string, body: unknown) {
  return post<Analysis>(`/v1/parcels/${encodeURIComponent(code)}/analyses`, body)
}

export function lotEvolution(code: string, signal?: AbortSignal) {
  return api<Evolution>(`/v1/lots/${encodeURIComponent(code)}/evolution`, { signal })
}

export function apiFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const field = error.fields ? Object.values(error.fields)[0] : undefined
    return field || error.message
  }
  return fallback
}
