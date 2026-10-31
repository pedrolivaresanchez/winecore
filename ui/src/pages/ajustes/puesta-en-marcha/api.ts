import { api } from '@/lib/api'

export type CheckStatus = 'ok' | 'missing' | 'warning'

export type SeriesSeed = {
  legal_entity_id: string
  legal_entity_code: string
  doc_type: string
  code: string
  year: number
  prefix: string
  padding: number
  is_default: boolean
  verifactu: boolean
}

export type EntityForm = {
  code: string
  legal_name: string
  tax_id: string
  address_line: string
  postal_code: string
  city: string
  province: string
  country_code: string
  eori: string | null
}

export type BankSeed = {
  id: string
  code: string
  legal_name: string
}

export type WarehouseSeed = {
  id: string
  name: string
  is_test: boolean
  cae_masked: string
}

export type ExerciseSeed = {
  tax_warehouse_id: string
  name: string
  year: number
}

export type LedgerSeed = {
  tax_warehouse_id: string
  name: string
}

export type BillingEntitySeed = {
  id: string
  code: string
  legal_name: string
}

export type SetupAction =
  | { kind: 'patch_entity'; entity: EntityForm }
  | { kind: 'create_series'; items: SeriesSeed[] }
  | { kind: 'create_bank'; entities: BankSeed[] }
  | { kind: 'register_mcp' }
  | { kind: 'rotate_mcp'; id: string }
  | { kind: 'patch_cae'; warehouse: WarehouseSeed }
  | { kind: 'open_exercise'; items: ExerciseSeed[] }
  | { kind: 'open_ledgers'; items: LedgerSeed[] }
  | { kind: 'request_billing_rules'; entities: BillingEntitySeed[] }
  | { kind: 'open_approvals' }

export type SetupCheck = {
  id: string
  status: CheckStatus
  title: string
  detail: string
  href: string | null
  action?: SetupAction
}

export type SetupModule = {
  id: string
  name: string
  pending: number
  checks: SetupCheck[]
}

export type Readiness = {
  generated_at: string
  pending: number
  modules: SetupModule[]
}

export function patchEntity(code: string, body: Record<string, string | null>) {
  return api<EntityForm>(`/v1/legal-entities/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function createSeries(items: SeriesSeed[]) {
  return api<{ items: { status: string }[] }>('/v1/number-series/bulk', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function createBankAccount(input: { legalEntityId: string; bankName: string; iban: string; bic: string }) {
  const body: Record<string, string | boolean> = {
    legal_entity_id: input.legalEntityId,
    bank_name: input.bankName,
    iban: input.iban.replace(/\s/g, ''),
    is_default: true,
  }
  const bic = input.bic.trim()
  if (bic) body.bic = bic
  return api('/v1/bank-accounts', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

export function registerCvbot() {
  return api<{ token: string }>('/v1/mcp/clients', {
    method: 'POST',
    body: JSON.stringify({
      code: 'cvbot',
      description: 'CVBOT',
      role_code: 'mcp_client',
      scopes: ['read:*'],
    }),
  })
}

export function rotateCvbot(id: string) {
  return api<{ token: string }>(`/v1/mcp/clients/${encodeURIComponent(id)}/rotate`, { method: 'POST' })
}

export function patchWarehouse(id: string, body: { cae: string; is_test: boolean }) {
  return api(`/v1/tax-warehouses/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function openExercise(item: ExerciseSeed) {
  return api('/v1/silicie-exercises', {
    method: 'POST',
    body: JSON.stringify({ tax_warehouse_id: item.tax_warehouse_id, year: item.year }),
  })
}

export function openLedgers(taxWarehouseId: string) {
  return api<{ items: { reference: string; status: string }[] }>('/v1/silicie-ledgers/opening', {
    method: 'POST',
    body: JSON.stringify({ tax_warehouse_id: taxWarehouseId }),
  })
}

export function requestBillingRules(issuingEntityId: string | null) {
  return api<{ approval_request_id: string; status: string }>('/v1/setup/billing-rules/request-activation', {
    method: 'POST',
    body: JSON.stringify(issuingEntityId ? { issuing_entity_id: issuingEntityId } : {}),
  })
}
