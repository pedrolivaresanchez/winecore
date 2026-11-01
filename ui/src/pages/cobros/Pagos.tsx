import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import {
  Badge,
  Button,
  DataGrid,
  Drawer,
  DrawerBody,
  DrawerHeader,
  EmptyState,
  GlassMenu,
  MenuItem,
  Pagination,
  StatusPill,
  Textarea,
  useCursorPages,
  useMenuOpen,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridColumn,
} from '@/ui'
import { MoreVertical } from '@/ui/icons'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError, api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { paymentsPath, reversePayment, type Payment, type PaymentPage } from '@/lib/finance'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import { entityTone } from '@/lib/status-tones'
import type { EntityChoice, Me } from '@/lib/types'
import { CobrosFrame } from '@/pages/cobros/CobrosFrame'
import { vistaOf } from '@/pages/cobros/vista'
import { entityCode, entityLabel, gridLabels, methodLabel, moneyOf, statusLabel } from '@/pages/cobros/money'
import { RegistrarDialog } from '@/pages/cobros/RegistrarDialog'

/** The API pages at most 100 payments at a time. */
const SIZES = [25, 50, 100] as const

/** The rail picks the entity; `?entity=all` overrides it for this view only. */
function entityOf(raw: string | null, rail: EntityChoice): string {
  if (raw === 'all') return ''
  if (raw === 'PO' || raw === 'CVPO') return raw
  return rail === 'all' ? '' : rail
}

export function Pagos({ me }: { me: Me }) {
  const { filter: rail } = useEntity()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const directionRaw = params.get('direction')
  const direction = directionRaw === 'in' || directionRaw === 'out' ? directionRaw : ''
  const entity = entityOf(params.get('entity'), rail)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const vista = vistaOf(params.get('vista'))
  const [q, setQ] = useState('')
  const [widths, setWidths] = useState<Record<string, number>>({ date: 120, who: 260, entity: 100, direction: 110, method: 150, amount: 140, status: 130 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [register, setRegister] = useState(false)
  const canWrite = allows(me, 'finance.write')
  const pages = useCursorPages<Payment>({
    queryKey: [direction, entity, from, to].join('|'),
    storageKey: 'cobros-pagos',
    sizes: SIZES,
    fetchPage: ({ cursor, limit, signal }) => api<PaymentPage>(paymentsPath({ entity, direction, from, to }, cursor, limit), { signal }),
  })

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  const query = q.trim().toLocaleLowerCase('es')
  const shown = useMemo(
    () =>
      pages.items.filter((item) => {
        if (!query) return true
        return `${item.counterparty_name ?? ''} ${item.reference ?? ''} ${item.amount}`.toLocaleLowerCase('es').includes(query)
      }),
    [pages.items, query],
  )
  const loadingFirst = pages.loading && pages.items.length === 0 && !pages.error
  const screen = loadingFirst ? 'cobros-cargando' : shown.length === 0 ? 'cobros-pagos-vacio' : 'cobros-pagos'
  const filtersActive = Boolean(query || direction || entity || from || to)
  const error = pages.error ? (pages.error instanceof ApiError ? pages.error : new ApiError(0, 'WC_ERROR', copy.error.load)) : null

  function update(change: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params)
    change(next)
    setParams(next, { replace: true })
  }

  function setFilter(id: string, value: FilterValue) {
    update((next) => {
      if (id === 'date') {
        const range = value && typeof value === 'object' && !Array.isArray(value) ? value : null
        if (range?.from) next.set('from', range.from)
        else next.delete('from')
        if (range?.to) next.set('to', range.to)
        else next.delete('to')
        return
      }
      const raw = typeof value === 'string' ? value : ''
      if (raw) next.set(id, raw)
      else if (id === 'entity' && rail !== 'all') next.set('entity', 'all')
      else next.delete(id)
    })
  }

  function clearFilters() {
    update((next) => {
      for (const key of ['direction', 'entity', 'from', 'to']) next.delete(key)
      if (rail !== 'all') next.set('entity', 'all')
    })
    setQ('')
  }

  const filters: FilterDef[] = [
    {
      id: 'direction',
      label: copy.cobros.direction,
      kind: 'single',
      display: 'chips',
      options: [
        { value: 'in', label: copy.cobros.collectionsOnly, tone: 'success' },
        { value: 'out', label: copy.cobros.paymentsOnly, tone: 'neutral' },
      ],
    },
    {
      id: 'entity',
      label: copy.salesDocs.entity,
      kind: 'single',
      options: me.entities.map((item) => ({ value: item.code, label: entityLabel(item.id, me.entities), tone: entityTone(item.code) })),
    },
    { id: 'date', label: copy.cobros.date, kind: 'date' },
  ]

  const columns = useMemo<GridColumn<Payment>[]>(
    () => [
      { id: 'date', header: copy.cobros.date, cell: (row) => (row.value_date ? formatDate(row.value_date) : '—') },
      { id: 'who', header: copy.cobros.counterparty, cell: (row) => row.counterparty_name ?? '—' },
      {
        id: 'entity',
        header: copy.salesDocs.entity,
        filterValue: (row) => entityLabel(row.legal_entity_id, me.entities),
        cell: (row) => <StatusPill tone={entityTone(entityCode(row.legal_entity_id, me.entities) ?? '')}>{entityLabel(row.legal_entity_id, me.entities)}</StatusPill>,
      },
      {
        id: 'direction',
        header: copy.cobros.direction,
        filterValue: (row) => (row.direction === 'in' ? copy.cobros.collection : copy.cobros.payment),
        cell: (row) => <StatusPill tone={row.direction === 'in' ? 'success' : 'neutral'}>{row.direction === 'in' ? copy.cobros.collection : copy.cobros.payment}</StatusPill>,
      },
      { id: 'method', header: copy.cobros.method, cell: (row) => methodLabel(row.method) },
      { id: 'amount', header: copy.cobros.amount, align: 'right', cell: (row) => <span className="tabular-nums">{moneyOf(row.amount)}</span> },
      {
        id: 'status',
        header: copy.cobros.status,
        filterValue: (row) => statusLabel(row.status),
        cell: (row) => <StatusPill tone={row.status === 'reversed' ? 'slate' : 'info'}>{statusLabel(row.status)}</StatusPill>,
      },
    ],
    [me.entities],
  )

  return (
    <CobrosFrame
      screen={screen}
      vista={vista}
      action={canWrite ? { label: copy.cobros.register, onClick: () => setRegister(true) } : null}
      bar={{
        search: { id: 'buscar-pagos', value: q, onChange: setQ, placeholder: copy.cobros.searchMovements },
        filters,
        values: { direction, entity, date: from || to ? { from: from || to, to: to || from } : null },
        onChange: setFilter,
        onClear: clearFilters,
      }}
    >
      {error && pages.items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={shown}
          rowKey={(row) => row.id}
          labels={gridLabels(copy.cobros.grid.openRecord)}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => setOpenId(row.id)}
          openRowKey={openId}
          total={pages.total ?? undefined}
          loading={pages.loading}
          scrollKey={pages.pageKey}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.cobros.noMatch : copy.cobros.movementsEmpty}
              description={filtersActive ? undefined : copy.cobros.movementsEmptyHint}
            />
          }
        />
      )}
      <Pagination {...pages.pagination} />
      <PagoDrawer
        me={me}
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          setOpenId(null)
          pages.reload()
          toast(copy.cobros.reversedToast, { tone: 'success' })
        }}
      />
      <RegistrarDialog
        me={me}
        open={register}
        direction="in"
        contactId={null}
        entityId={null}
        onClose={() => setRegister(false)}
        onSaved={(warnings) => {
          setRegister(false)
          toast(copy.cobros.saved, warnings[0] ? { tone: 'warning', description: warnings[0] } : { tone: 'success' })
          pages.reload()
        }}
      />
    </CobrosFrame>
  )
}

function PagoDrawer({
  me,
  id,
  onClose,
  onChanged,
}: {
  me: Me
  id: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const detail = useApi<Payment>(id ? `/v1/payments/${id}` : null)
  const more = useMenuOpen()
  const canManage = allows(me, 'finance.manage')
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const payment = detail.data
  const name = payment?.counterparty_name ?? '—'

  async function reverse() {
    if (!payment || reason.trim().length < 3) return
    setSaving(true)
    setError(null)
    try {
      await reversePayment(payment.id, reason.trim())
      setConfirm(false)
      onChanged()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Drawer open={Boolean(id)} onClose={onClose} labelledBy="pago-title" size="md">
        <DrawerHeader
          titleId="pago-title"
          title={name}
          description={payment ? `${payment.direction === 'in' ? copy.cobros.collection : copy.cobros.payment} · ${moneyOf(payment.amount)}` : undefined}
          onClose={onClose}
        />
        <DrawerBody>
          {detail.loading && !payment ? <p className="text-label text-text-tertiary">{copy.loading}</p> : null}
          {detail.error ? <ErrorState title={detail.error.message} onRetry={detail.reload} /> : null}
          {payment ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-2">
                <Badge tone={payment.status === 'reversed' ? 'neutral' : 'info'}>{statusLabel(payment.status)}</Badge>
                {canManage && payment.status === 'registered' ? (
                  <GlassMenu
                    open={more.open}
                    onOpenChange={more.setOpen}
                    placement="bottom-end"
                    trigger={
                      <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.cobros.reverse} onClick={more.toggle}>
                        <MoreVertical strokeWidth={iconStroke} />
                      </Button>
                    }
                  >
                    <MenuItem
                      tone="danger"
                      onClick={() => {
                        more.close()
                        setReason('')
                        setError(null)
                        setConfirm(true)
                      }}
                    >
                      {copy.cobros.reverse}
                    </MenuItem>
                  </GlassMenu>
                ) : null}
              </div>
              <section className="overflow-hidden rounded-2xl border border-border-subtle">
                <Fact label={copy.cobros.date} value={payment.value_date ? formatDate(payment.value_date) : '—'} />
                <Fact label={copy.cobros.method} value={methodLabel(payment.method)} />
                <Fact label={copy.cobros.entity} value={entityLabel(payment.legal_entity_id, me.entities)} />
                <Fact label={copy.cobros.reference} value={payment.reference || '—'} />
                <Fact label={copy.cobros.unallocated} value={moneyOf(payment.unallocated)} />
                {payment.reversal_reason ? <Fact label={copy.cobros.reason} value={payment.reversal_reason} /> : null}
              </section>
              <section className="overflow-hidden rounded-2xl border border-border-subtle">
                <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{copy.cobros.allocations}</h2>
                {payment.allocations.length === 0 ? <p className="px-4 py-3 text-label text-text-secondary">—</p> : null}
                {payment.allocations.map((allocation) => (
                  <div key={allocation.id} className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2 last:border-b-0">
                    <span className="min-w-0 truncate text-label text-ink-900">{allocation.document_number || allocation.target_id.slice(0, 8)}</span>
                    <span className="shrink-0 tabular-nums text-label">{moneyOf(allocation.amount)}</span>
                  </div>
                ))}
              </section>
            </div>
          ) : null}
        </DrawerBody>
      </Drawer>
      <ConfirmDialog
        open={confirm}
        title={copy.cobros.reverseTitle}
        body={
          <div className="grid gap-3">
            <p>{copy.cobros.reverseBody}</p>
            <Textarea
              aria-label={copy.cobros.reason}
              value={reason}
              rows={3}
              maxLength={500}
              invalid={Boolean(error)}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-caption text-text-tertiary">{copy.cobros.reasonHint}</p>
            {error ? <p className="text-caption text-danger-600">{error}</p> : null}
          </div>
        }
        confirmLabel={copy.cobros.reverse}
        danger
        busy={saving}
        onClose={() => setConfirm(false)}
        onConfirm={() => void reverse()}
      />
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}
