import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Field } from '@/components/Field'
import { ErrorState } from '@/components/ErrorState'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError, fieldError } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { openSettings } from '@/pages/ajustes/seguridad/open-settings'
import { isOwner } from '@/pages/aprobaciones/model'
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Select,
  Skeleton,
  StatusChip,
  useToast,
  type BadgeTone,
} from '@/ui'
import {
  createBankAccount,
  createSeries,
  patchEntity,
  registerCvbot,
  rotateCvbot,
  type BankSeed,
  type EntityForm,
  type Readiness,
  type SeriesSeed,
  type SetupAction,
  type SetupCheck,
} from '@/pages/ajustes/puesta-en-marcha/api'

const DOC: Record<string, string> = {
  invoice: 'Facturas',
  credit_note: 'Rectificativas',
  simplified_invoice: 'Simplificadas',
  intercompany_invoice: 'Intercompañía',
  delivery_note: 'Albaranes',
  quote: 'Presupuestos',
  sales_order: 'Pedidos',
  proforma: 'Proformas',
  cellar_operation: 'Bodega',
  inventory_count: 'Aforos',
}

const TONE: Record<SetupCheck['status'], BadgeTone> = {
  ok: 'success',
  missing: 'danger',
  warning: 'warning',
}

export function SetupPanel({ me }: { me: Me }) {
  const ready = useApi<Readiness>('/v1/setup/readiness')
  const owner = isOwner(me)
  const [entity, setEntity] = useState<EntityForm | null>(null)
  const [series, setSeries] = useState<SeriesSeed[] | null>(null)
  const [banks, setBanks] = useState<BankSeed[] | null>(null)
  const [mcp, setMcp] = useState<'register' | { id: string } | null>(null)

  if (ready.loading && !ready.data) {
    return (
      <div aria-busy="true" className="grid gap-3" data-screen="puesta-en-marcha-cargando">
        <p className="sr-only">{copy.loading}</p>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (ready.error || !ready.data) {
    return (
      <ErrorState
        title={`${copy.error.load} (${ready.error?.code ?? 'WC_ERROR'})`}
        detail={ready.error?.message}
        onRetry={ready.reload}
      />
    )
  }

  function open(action: SetupAction) {
    if (action.kind === 'patch_entity') setEntity(action.entity)
    if (action.kind === 'create_series') setSeries(action.items)
    if (action.kind === 'create_bank') setBanks(action.entities)
    if (action.kind === 'register_mcp') setMcp('register')
    if (action.kind === 'rotate_mcp') setMcp({ id: action.id })
  }

  return (
    <div data-screen="puesta-en-marcha" className="flex flex-col gap-6">
      {ready.data.modules.map((module) => (
        <section key={module.id} aria-labelledby={`modulo-${module.id}`} data-module={module.id}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id={`modulo-${module.id}`} className="text-label font-medium text-ink-900">
              {module.name}
            </h2>
            <StatusChip tone={module.pending > 0 ? 'warning' : 'success'}>
              {module.pending === 0 ? copy.setup.clear : fill(copy.setup.pending, { count: String(module.pending) })}
            </StatusChip>
          </div>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface">
            {module.checks.map((check) => (
              <li key={check.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-label font-medium text-ink-900">{check.title}</p>
                  <StatusChip tone={TONE[check.status]}>{copy.setup[check.status]}</StatusChip>
                </div>
                <p className="mt-0.5 text-caption text-text-tertiary">{check.detail}</p>
                {owner ? (
                  <div className="mt-2 empty:hidden">
                    <CheckAction check={check} onOpen={open} />
                  </div>
                ) : (
                  <div className="mt-2 empty:hidden">
                    <ReadLink check={check} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {entity ? (
        <EntityDialog
          key={entity.code}
          entity={entity}
          onClose={() => setEntity(null)}
          onSaved={() => {
            setEntity(null)
            ready.reload()
          }}
        />
      ) : null}
      {series ? (
        <SeriesDialog
          items={series}
          onClose={() => setSeries(null)}
          onSaved={() => {
            setSeries(null)
            ready.reload()
          }}
        />
      ) : null}
      {banks ? (
        <BankDialog
          entities={banks}
          onClose={() => setBanks(null)}
          onSaved={() => {
            setBanks(null)
            ready.reload()
          }}
        />
      ) : null}
      {mcp ? (
        <McpDialog
          rotateId={mcp === 'register' ? null : mcp.id}
          onClose={() => setMcp(null)}
          onSaved={ready.reload}
        />
      ) : null}
    </div>
  )
}

export function SetupCard({ me }: { me: Me }) {
  const owner = isOwner(me)
  const ready = useApi<Readiness>(owner ? '/v1/setup/readiness' : null)
  if (!owner) return null
  if (!ready.data) {
    return ready.error ? null : <Skeleton className="h-12 rounded-2xl" />
  }
  const pending = ready.data.pending > 0
  return (
    <Link
      to="/ajustes/puesta-en-marcha"
      data-setup-pending={ready.data.pending}
      className={cn(
        'flex items-center rounded-2xl border px-4 py-3 text-label outline-none focus-visible:shadow-(--shadow-focus)',
        pending ? 'border-ink-900/10 bg-warning-50 text-warning-700' : 'border-border-subtle bg-surface-subtle text-ink-900',
      )}
    >
      {fill(copy.panel.setup, { count: String(ready.data.pending) })}
    </Link>
  )
}

function CheckAction({ check, onOpen }: { check: SetupCheck; onOpen: (action: SetupAction) => void }) {
  if (check.status === 'ok') return null
  const action = check.action
  if (action?.kind === 'patch_entity' || action?.kind === 'create_bank') {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(action)}>
        {copy.setup.fix}
      </Button>
    )
  }
  if (action?.kind === 'create_series') {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(action)}>
        {copy.setup.series}
      </Button>
    )
  }
  if (action?.kind === 'register_mcp') {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(action)}>
        {copy.setup.mcpRegister}
      </Button>
    )
  }
  if (action?.kind === 'rotate_mcp') {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(action)}>
        {copy.setup.rotate}
      </Button>
    )
  }
  return <ReadLink check={check} />
}

function ReadLink({ check }: { check: SetupCheck }) {
  const navigate = useNavigate()
  if (check.status === 'ok' || !check.href) return null
  if (check.href === 'settings:security') {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => openSettings('security')}>
        {copy.setup.passkey}
      </Button>
    )
  }
  const href = check.href
  if (!href.startsWith('/') || href.startsWith('/ajustes/puesta-en-marcha')) return null
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => navigate(href)}>
      {copy.setup.open}
    </Button>
  )
}

function EntityDialog({
  entity,
  onClose,
  onSaved,
}: {
  entity: EntityForm
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [legalName, setLegalName] = useState(entity.legal_name)
  const [taxId, setTaxId] = useState(entity.tax_id)
  const [address, setAddress] = useState(entity.address_line)
  const [postal, setPostal] = useState(entity.postal_code)
  const [city, setCity] = useState(entity.city)
  const [province, setProvince] = useState(entity.province)
  const [country, setCountry] = useState(entity.country_code)
  const [eori, setEori] = useState(entity.eori ?? '')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await patchEntity(entity.code, {
        legal_name: legalName.trim(),
        tax_id: taxId.trim(),
        address_line: address.trim(),
        postal_code: postal.trim(),
        city: city.trim(),
        province: province.trim(),
        country_code: country.trim(),
        eori: eori.trim() === '' ? null : eori.trim(),
      })
      toast(copy.setup.saved, { tone: 'success' })
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="entidad-titulo">
      <DialogHeader titleId="entidad-titulo" title={`${copy.setup.entityTitle} · ${labelOf(entity.code)}`} onClose={onClose} />
      <DialogBody>
        <form id="entidad-form" className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
          {error && !error.fields ? <Alert tone="danger">{error.message}</Alert> : null}
          <Field id="razon" label={copy.setup.legalName} error={fieldError(error, 'legal_name')}>
            <Input id="razon" value={legalName} invalid={Boolean(fieldError(error, 'legal_name'))} onChange={(event) => setLegalName(event.target.value)} />
          </Field>
          <Field id="nif" label={copy.setup.taxId} error={fieldError(error, 'tax_id')}>
            <Input id="nif" value={taxId} autoComplete="off" invalid={Boolean(fieldError(error, 'tax_id'))} onChange={(event) => setTaxId(event.target.value)} />
          </Field>
          <Field id="direccion" label={copy.setup.address} error={fieldError(error, 'address_line')}>
            <Input id="direccion" value={address} invalid={Boolean(fieldError(error, 'address_line'))} onChange={(event) => setAddress(event.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cp" label={copy.setup.postal} error={fieldError(error, 'postal_code')}>
              <Input id="cp" value={postal} inputMode="numeric" invalid={Boolean(fieldError(error, 'postal_code'))} onChange={(event) => setPostal(event.target.value)} />
            </Field>
            <Field id="pais" label={copy.setup.country} error={fieldError(error, 'country_code')}>
              <Input id="pais" value={country} maxLength={2} invalid={Boolean(fieldError(error, 'country_code'))} onChange={(event) => setCountry(event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="localidad" label={copy.setup.city} error={fieldError(error, 'city')}>
              <Input id="localidad" value={city} invalid={Boolean(fieldError(error, 'city'))} onChange={(event) => setCity(event.target.value)} />
            </Field>
            <Field id="provincia" label={copy.setup.province} error={fieldError(error, 'province')}>
              <Input id="provincia" value={province} invalid={Boolean(fieldError(error, 'province'))} onChange={(event) => setProvince(event.target.value)} />
            </Field>
          </div>
          <Field id="eori" label={copy.setup.eori} error={fieldError(error, 'eori')}>
            <Input id="eori" value={eori} autoComplete="off" invalid={Boolean(fieldError(error, 'eori'))} onChange={(event) => setEori(event.target.value)} />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>{copy.setup.cancel}</Button>
        <Button type="submit" form="entidad-form" variant="primary" size="sm" loading={busy}>{copy.setup.save}</Button>
      </DialogFooter>
    </Dialog>
  )
}

function SeriesDialog({
  items,
  onClose,
  onSaved,
}: {
  items: SeriesSeed[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await createSeries(items)
      toast(copy.setup.saved, { tone: 'success' })
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.error.load)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="series-titulo">
      <DialogHeader titleId="series-titulo" title={copy.setup.seriesTitle} description={copy.setup.seriesHint} onClose={onClose} />
      <DialogBody>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ul className="mt-2 grid gap-1">
          {items.map((item) => (
            <li key={`${item.legal_entity_id}-${item.doc_type}-${item.year}`} className="text-caption text-text-secondary">
              {labelOf(item.legal_entity_code)} · {DOC[item.doc_type] ?? item.doc_type} · {item.prefix}
            </li>
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>{copy.setup.cancel}</Button>
        <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void save()}>{copy.setup.series}</Button>
      </DialogFooter>
    </Dialog>
  )
}

function BankDialog({
  entities,
  onClose,
  onSaved,
}: {
  entities: BankSeed[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [entityId, setEntityId] = useState(entities[0]?.id ?? '')
  const [bank, setBank] = useState('')
  const [iban, setIban] = useState('')
  const [bic, setBic] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await createBankAccount({ legalEntityId: entityId, bankName: bank.trim(), iban, bic })
      toast(copy.setup.saved, { tone: 'success' })
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="cuenta-titulo">
      <DialogHeader titleId="cuenta-titulo" title={copy.setup.bankTitle} onClose={onClose} />
      <DialogBody>
        <form id="cuenta-form" className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
          {error && !error.fields ? <Alert tone="danger">{error.message}</Alert> : null}
          {entities.length > 1 ? (
            <Field id="cuenta-entidad" label={copy.settings.entities}>
              <Select id="cuenta-entidad" className="w-full" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>{labelOf(entity.code)}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="banco" label={copy.setup.bank} error={fieldError(error, 'bank_name')}>
            <Input id="banco" value={bank} invalid={Boolean(fieldError(error, 'bank_name'))} onChange={(event) => setBank(event.target.value)} />
          </Field>
          <Field id="iban" label={copy.setup.iban} error={fieldError(error, 'iban')}>
            <Input id="iban" value={iban} autoComplete="off" spellCheck={false} invalid={Boolean(fieldError(error, 'iban'))} onChange={(event) => setIban(event.target.value)} />
          </Field>
          <Field id="bic" label={copy.setup.bic} error={fieldError(error, 'bic')}>
            <Input id="bic" value={bic} autoComplete="off" invalid={Boolean(fieldError(error, 'bic'))} onChange={(event) => setBic(event.target.value)} />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>{copy.setup.cancel}</Button>
        <Button type="submit" form="cuenta-form" variant="primary" size="sm" loading={busy}>{copy.setup.save}</Button>
      </DialogFooter>
    </Dialog>
  )
}

function McpDialog({
  rotateId,
  onClose,
  onSaved,
}: {
  rotateId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const created = rotateId ? await rotateCvbot(rotateId) : await registerCvbot()
      setToken(created.token)
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.error.load)
    } finally {
      setBusy(false)
    }
  }

  async function copyToken() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      toast(copy.setup.copied, { tone: 'success' })
    } catch {
      toast(copy.error.load, { tone: 'warning' })
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="cvbot-titulo">
      <DialogHeader
        titleId="cvbot-titulo"
        title={rotateId ? copy.setup.rotate : copy.setup.mcpTitle}
        description={copy.setup.mcpHint}
        onClose={onClose}
      />
      <DialogBody>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {token ? (
          <Field id="token" label={copy.setup.token}>
            <Input id="token" readOnly value={token} spellCheck={false} autoComplete="off" />
          </Field>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>{copy.setup.cancel}</Button>
        {token ? (
          <Button type="button" variant="primary" size="sm" onClick={() => void copyToken()}>{copy.setup.copy}</Button>
        ) : (
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void save()}>
            {rotateId ? copy.setup.rotate : copy.setup.mcpRegister}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}

function labelOf(code: string): string {
  return code === 'PO' ? 'P.O' : code
}
