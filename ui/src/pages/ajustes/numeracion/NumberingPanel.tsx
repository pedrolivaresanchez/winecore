import { useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError, fieldError } from '@/lib/api'
import { todayMadrid } from '@/lib/sales'
import type { Me } from '@/lib/types'
import { entityLabel } from '@/pages/facturas/format'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  Table,
  useToast,
  type TableColumn,
} from '@/ui'
import { FISCAL_DOCS, deactivateSeries, patchEntity, type FiscalDoc, type LegalEntity, type Series } from './api'
import { canManageNumbering, docLabel } from './model'
import { NumberingChoice } from './NumberingChoice'

const DOC_ORDER = ['invoice', 'credit_note', 'simplified_invoice', 'intercompany_invoice', 'quote', 'sales_order', 'delivery_note', 'proforma', 'cellar_operation', 'inventory_count']

const ENTITY_FIELDS = ['legal_name', 'tax_id', 'address_line', 'postal_code', 'city', 'province', 'country_code', 'eori'] as const

type EntityField = (typeof ENTITY_FIELDS)[number]

export function NumberingPanel({ me }: { me: Me }) {
  const toast = useToast()
  const manage = canManageNumbering(me)
  const entities = useApi<{ items: LegalEntity[] }>(manage ? '/v1/legal-entities' : null)
  const series = useApi<{ items: Series[] }>(manage ? '/v1/number-series' : null)
  const [editing, setEditing] = useState<LegalEntity | null>(null)
  const [creating, setCreating] = useState<LegalEntity | null>(null)
  const [retiring, setRetiring] = useState<Series | null>(null)
  const [busy, setBusy] = useState(false)

  const byEntity = useMemo(() => {
    const groups = new Map<string, Series[]>()
    for (const item of series.data?.items ?? []) {
      groups.set(item.legal_entity_id, [...(groups.get(item.legal_entity_id) ?? []), item])
    }
    for (const rows of groups.values()) {
      rows.sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.year - a.year || DOC_ORDER.indexOf(a.doc_type) - DOC_ORDER.indexOf(b.doc_type))
    }
    return groups
  }, [series.data])

  if (!manage) return <NoPermission />

  async function retire(item: Series) {
    setBusy(true)
    try {
      await deactivateSeries(item.id)
      toast(copy.numbering.deactivated, { tone: 'success' })
      setRetiring(null)
      series.reload()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const failed = entities.error ?? series.error
  if (failed) {
    return (
      <div className="grid gap-3">
        <Alert tone="danger">{`${copy.error.load} (${failed.code})`}</Alert>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={() => {
            entities.reload()
            series.reload()
          }}
        >
          {copy.error.retry}
        </Button>
      </div>
    )
  }
  if (!entities.data || !series.data) {
    return (
      <div aria-busy="true" className="grid gap-3">
        <p className="sr-only">{copy.loading}</p>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div data-screen="numeracion" className="grid gap-8">
      {entities.data.items.map((entity) => (
        <EntitySection
          key={entity.id}
          entity={entity}
          series={byEntity.get(entity.id) ?? []}
          onEdit={() => setEditing(entity)}
          onCreate={() => setCreating(entity)}
          onRetire={setRetiring}
        />
      ))}
      {editing ? (
        <EntityDialog
          entity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            entities.reload()
          }}
        />
      ) : null}
      {creating ? (
        <SeriesDialog
          entity={creating}
          onClose={() => setCreating(null)}
          onOpened={() => {
            setCreating(null)
            series.reload()
          }}
        />
      ) : null}
      <ConfirmDialog
        open={retiring !== null}
        title={fill(copy.numbering.deactivateTitle, { prefix: retiring?.prefix ?? '' })}
        body={copy.numbering.deactivateBody}
        confirmLabel={copy.numbering.deactivate}
        danger
        busy={busy}
        onConfirm={() => {
          if (retiring) void retire(retiring)
        }}
        onClose={() => {
          if (!busy) setRetiring(null)
        }}
      />
    </div>
  )
}

function EntitySection({
  entity,
  series,
  onEdit,
  onCreate,
  onRetire,
}: {
  entity: LegalEntity
  series: Series[]
  onEdit: () => void
  onCreate: () => void
  onRetire: (series: Series) => void
}) {
  const place = [entity.address_line, [entity.postal_code, entity.city].filter(Boolean).join(' '), entity.province, entity.country_code]
    .filter(Boolean)
    .join(', ')
  const columns: TableColumn<Series>[] = [
    { id: 'doc', header: copy.numbering.docType, cell: (row) => `${docLabel(row.doc_type)} · ${row.year}` },
    { id: 'prefix', header: copy.numbering.prefix, width: '7rem', hideOnMobile: true, cell: (row) => <span className="font-mono">{row.prefix}</span> },
    { id: 'next', header: copy.numbering.next, width: '8rem', cell: (row) => <span className="font-mono">{nextNumber(row)}</span> },
    {
      id: 'status',
      header: copy.numbering.status,
      width: '9rem',
      clip: false,
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          <Badge size="sm" tone={row.is_active ? 'success' : 'neutral'} dot>
            {row.is_active ? copy.numbering.activeBadge : copy.numbering.inactiveBadge}
          </Badge>
          {row.verifactu ? <Badge size="sm" tone="info">{copy.numbering.verifactuBadge}</Badge> : null}
        </span>
      ),
    },
  ]

  return (
    <section data-entity={entity.code} className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-label font-medium text-ink-900">{`${entityLabel(entity.code)} · ${entity.legal_name}`}</h2>
          <p className="mt-0.5 text-caption text-text-secondary">{`${copy.numbering.taxId} ${entity.tax_id}`}</p>
          {place ? <p className="text-caption text-text-tertiary">{place}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            {copy.numbering.edit}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onCreate}>
            {copy.numbering.newSeries}
          </Button>
        </div>
      </div>
      <Table
        variant="card"
        columns={columns}
        rows={series}
        rowKey={(row) => row.id}
        empty={<p className="px-4 py-3 text-label text-text-tertiary">{copy.numbering.empty}</p>}
        rowActions={(row) =>
          row.is_active ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onRetire(row)}>
              {copy.numbering.deactivate}
            </Button>
          ) : null
        }
      />
    </section>
  )
}

function nextNumber(series: Series): string {
  return `${series.prefix}${String(series.next_value).padStart(series.padding, '0')}`
}

function EntityDialog({ entity, onClose, onSaved }: { entity: LegalEntity; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<Record<EntityField, string>>(() => ({
    legal_name: entity.legal_name,
    tax_id: entity.tax_id,
    address_line: entity.address_line,
    postal_code: entity.postal_code,
    city: entity.city,
    province: entity.province,
    country_code: entity.country_code,
    eori: entity.eori ?? '',
  }))
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const changed: Record<string, string | null> = {}
    for (const field of ENTITY_FIELDS) {
      const value = form[field].trim()
      const before = (entity[field] ?? '').trim()
      if (value !== before) changed[field] = field === 'eori' && value === '' ? null : value
    }
    if (Object.keys(changed).length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await patchEntity(entity.code, changed)
      toast(copy.numbering.saved, { tone: 'success' })
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.api.generic))
    } finally {
      setBusy(false)
    }
  }

  function input(field: EntityField, id: string, label: string, extra: { inputMode?: 'numeric'; maxLength?: number } = {}) {
    const message = fieldError(error, field)
    return (
      <Field id={id} label={label} error={message}>
        <Input
          id={id}
          value={form[field]}
          autoComplete="off"
          invalid={Boolean(message)}
          onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
          {...extra}
        />
      </Field>
    )
  }

  return (
    <Dialog open onClose={onClose} labelledBy="sociedad-titulo">
      <DialogHeader titleId="sociedad-titulo" title={fill(copy.numbering.entityTitle, { entity: entityLabel(entity.code) })} onClose={onClose} />
      <DialogBody>
        <form
          id="sociedad-form"
          data-screen="sociedad-editar"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {error && !error.fields ? <Alert tone="danger">{error.message}</Alert> : null}
          {input('legal_name', 'sociedad-razon', copy.numbering.legalName)}
          {input('tax_id', 'sociedad-nif', copy.numbering.taxId)}
          {input('address_line', 'sociedad-direccion', copy.numbering.address)}
          <div className="grid gap-4 sm:grid-cols-2">
            {input('postal_code', 'sociedad-cp', copy.numbering.postal, { inputMode: 'numeric' })}
            {input('country_code', 'sociedad-pais', copy.numbering.country, { maxLength: 2 })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {input('city', 'sociedad-localidad', copy.numbering.city)}
            {input('province', 'sociedad-provincia', copy.numbering.province)}
          </div>
          {input('eori', 'sociedad-eori', copy.numbering.eori)}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
          {copy.numbering.cancel}
        </Button>
        <Button type="submit" form="sociedad-form" variant="primary" size="sm" loading={busy}>
          {copy.numbering.save}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function SeriesDialog({ entity, onClose, onOpened }: { entity: LegalEntity; onClose: () => void; onOpened: () => void }) {
  const toast = useToast()
  const current = Number(todayMadrid().slice(0, 4))
  const [docType, setDocType] = useState<FiscalDoc>('invoice')
  const [year, setYear] = useState(String(current))
  const [busy, setBusy] = useState(false)
  const need = { legal_entity_id: entity.id, entity_code: entity.code, doc_type: docType, year: Number(year) }

  return (
    <Dialog open onClose={onClose} labelledBy="serie-nueva-titulo">
      <DialogHeader titleId="serie-nueva-titulo" title={`${copy.numbering.newSeries} · ${entityLabel(entity.code)}`} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-4">
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field id="serie-nueva-documento" label={copy.numbering.docType}>
              <Select id="serie-nueva-documento" className="w-full" value={docType} onChange={(event) => setDocType(event.target.value as FiscalDoc)}>
                {FISCAL_DOCS.map((code) => (
                  <option key={code} value={code}>
                    {docLabel(code)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid content-start gap-1.5">
              <span className="text-label text-text-secondary">{copy.numbering.year}</span>
              <SegmentedControl
                aria-label={copy.numbering.year}
                value={year}
                onChange={setYear}
                options={[current, current + 1].map((value) => ({ value: String(value), content: String(value) }))}
              />
            </div>
          </div>
          <NumberingChoice
            key={`${docType}-${year}`}
            need={need}
            formId="serie-nueva-form"
            onBusy={setBusy}
            onOpened={(series) => {
              if (series) toast(fill(copy.numbering.opened, { prefix: series.prefix }), { tone: 'success' })
              onOpened()
            }}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
          {copy.numbering.cancel}
        </Button>
        <Button type="submit" form="serie-nueva-form" variant="primary" size="sm" loading={busy}>
          {copy.numbering.use}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
