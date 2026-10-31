import { api } from '@/lib/api'
import type { Settlement, Tariff, TariffInput } from '@/pages/intercompania/model'

export function listTariffs(signal?: AbortSignal): Promise<{ items: Tariff[] }> {
  return api('/v1/intercompany/tariffs', { signal })
}

export function createTariff(body: TariffInput): Promise<Tariff> {
  return api('/v1/intercompany/tariffs', { method: 'POST', body: JSON.stringify(body) })
}

export function updateTariff(id: string, body: TariffInput): Promise<Tariff> {
  return api(`/v1/intercompany/tariffs/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function activateTariff(id: string): Promise<Tariff> {
  return api(`/v1/intercompany/tariffs/${id}/activate`, { method: 'POST', body: '{}' })
}

export function retireTariff(id: string): Promise<Tariff> {
  return api(`/v1/intercompany/tariffs/${id}/retire`, { method: 'POST', body: '{}' })
}

export function getSettlement(period: string, signal?: AbortSignal): Promise<Settlement> {
  return api(`/v1/intercompany/settlements?period=${encodeURIComponent(period)}`, { signal })
}

export function closePeriod(period: string, belowCostAcknowledged = false): Promise<Settlement> {
  return api('/v1/intercompany/settlements/close', {
    method: 'POST',
    body: JSON.stringify({
      period,
      ...(belowCostAcknowledged ? { below_cost_acknowledged: true } : {}),
    }),
  })
}

export function requestInvoice(id: string): Promise<Settlement> {
  return api(`/v1/intercompany/settlements/${id}/invoice-request`, { method: 'POST', body: '{}' })
}
