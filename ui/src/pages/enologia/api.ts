import { api } from '@/lib/api'
import type {
  AlcoholRequest,
  AlcoholResult,
  BlendRequest,
  BlendResult,
  CheckRequest,
  CheckResult,
  ColdRequest,
  ColdResult,
  SettingsPut,
  SettingsView,
  So2Request,
  So2Result,
} from '@/pages/enologia/types'

export function calculateSo2(body: So2Request) {
  return api<So2Result>('/v1/enology/calculators/so2', { method: 'POST', body: JSON.stringify(body) })
}

export function calculateCold(body: ColdRequest) {
  return api<ColdResult>('/v1/enology/calculators/cold_stabilisation', { method: 'POST', body: JSON.stringify(body) })
}

export function calculateAlcohol(body: AlcoholRequest) {
  return api<AlcoholResult>('/v1/enology/calculators/probable_alcohol', { method: 'POST', body: JSON.stringify(body) })
}

export function calculateBlend(body: BlendRequest) {
  return api<BlendResult>('/v1/enology/calculators/blend', { method: 'POST', body: JSON.stringify(body) })
}

export function readEnologySettings(legalEntityId: string) {
  const params = new URLSearchParams({ legal_entity_id: legalEntityId })
  return api<SettingsView>(`/v1/enology/settings?${params}`)
}

export function writeEnologySettings(body: SettingsPut) {
  return api<SettingsView>('/v1/enology/settings', { method: 'PUT', body: JSON.stringify(body) })
}

export function runEnologyChecks(body: CheckRequest) {
  return api<CheckResult>('/v1/enology/checks', { method: 'POST', body: JSON.stringify(body) })
}
