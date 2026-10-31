import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { Badge, Button, Chip, DataGrid, Drawer, DrawerBody, DrawerHeader, EmptyState, GlassMenu, Input, MenuItem, Textarea, useMenuOpen, useToast, type GridColumn } from '@/ui'
import { MoreVertical, Search } from '@/ui/icons'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError, api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { paymentsPath, reversePayment, type Payment, type PaymentPage } from '@/lib/finance'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { CobrosFrame } from '@/pages/cobros/CobrosFrame'
import { vistaOf } from '@/pages/cobros/vista'
import { entityLabel, gridLabels, methodLabel, moneyOf, statusLabel } from '@/pages/cobros/money'
import { RegistrarDialog } from '@/pages/cobros/RegistrarDialog'

type NameMap = Record<string, string>

export function Pagos({ me }: { me: Me }) {
  const { entityCode } = useEntity()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const direction = params.get('direction') ?? ''
  const vista = vistaOf(params.get('vista'))
  const [q, setQ] = useState('')
  const [names, setNames] = useState<NameMap>({})
  const [widths, setWidths] = useState<Record<string, number>>({ date: 120, who: 260, direction: 110, method: 150, amount: 140, status: 130 })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [register, setRegister] = useState(false)
  const canWrite = allows(me, 'finance.write')
  const page = useApi<PaymentPage>(paymentsPath(entityCode, direction || null))
  const items = useMemo(() => page.data?.items ?? [], [page.data])

  useEffect(() => {
    const missing = items.map((item) => item.counterparty_id).filter((id): id is string => Boolean(id && !names[id]))
    if (missing.length === 0) return
    const controller = new AbortController()
    void Promise.all(
      [...new Set(missing)].map(async (id) => {
        try {
          const contact = await api<{ legal_name: string }>(`/v1/contacts/${id}`, { signal: controller.signal })
          return [id, contact.legal_name] as const
        } catch {
          return [id, id.slice(0, 8)] as const
        }
      }),
    ).then((pairs) => {
      if (controller.signal.aborted) return
      setNames((current) => {
        const next = { ...current }
        for (const [id, name] of pairs) next[id] = name
        return next
      })
    })
    return () => controller.abort()
  }, [items, names])

  const query = q.trim().toLocaleLowerCase('es')
  const shown = useMemo(
    () =>
      items.filter((item) => {
        if (!query) return true
        const name = (item.counterparty_id ? names[item.counterparty_id] : '') ?? ''
        return `${name} ${item.reference ?? ''} ${item.amount}`.toLocaleLowerCase('es').includes(query)
      }),
    [items, names, query],
  )
  const screen = page.loading ? 'cobros-cargando' : shown.length === 0 ? 'cobros-pagos-vacio' : 'cobros-pagos'
  const filtersActive = Boolean(query || direction)

  function setDirection(next: string) {
    const queryParams = new URLSearchParams(params)
    if (next) queryParams.set('direction', next)
    else queryParams.delete('direction')
    setParams(queryParams, { replace: true })
  }

  const columns = useMemo<GridColumn<Payment>[]>(
    () => [
      { id: 'date', header: copy.cobros.date, cell: (row) => (row.value_date ? formatDate(row.value_date) : '—') },
      { id: 'who', header: copy.cobros.counterparty, cell: (row) => (row.counterparty_id ? names[row.counterparty_id] ?? '…' : '—') },
      {
        id: 'direction',
        header: copy.cobros.direction,
        cell: (row) => <Badge size="sm" tone={row.direction === 'in' ? 'success' : 'neutral'}>{row.direction === 'in' ? copy.cobros.collection : copy.cobros.payment}</Badge>,
      },
      { id: 'method', header: copy.cobros.method, cell: (row) => methodLabel(row.method) },
      { id: 'amount', header: copy.cobros.amount, align: 'right', cell: (row) => <span className="tabular-nums">{moneyOf(row.amount)}</span> },
      {
        id: 'status',
        header: copy.cobros.status,
        cell: (row) => <Badge size="sm" tone={row.status === 'reversed' ? 'neutral' : 'info'}>{statusLabel(row.status)}</Badge>,
      },
    ],
    [names],
  )

  return (
    <CobrosFrame
      screen={screen}
      vista={vista}
      action={canWrite ? { label: copy.cobros.register, onClick: () => setRegister(true) } : null}
      toolbar={
        <Input
          id="buscar-pagos"
          size="sm"
          type="search"
          value={q}
          placeholder={copy.cobros.searchMovements}
          aria-label={copy.cobros.searchMovements}
          className="w-56 shrink-0"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => setQ(event.target.value)}
        />
      }
      filters={
        <>
          {[
            { id: '', label: copy.cobros.allDirections },
            { id: 'in', label: copy.cobros.collectionsOnly },
            { id: 'out', label: copy.cobros.paymentsOnly },
          ].map((pill) => (
            <Chip key={pill.id || 'all'} pressed={direction === pill.id} active={direction === pill.id} onClick={() => setDirection(direction === pill.id ? '' : pill.id)}>
              {pill.label}
            </Chip>
          ))}
        </>
      }
    >
      {page.error && !page.data ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${page.error.code})`} detail={page.error.message} onRetry={page.reload} />
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
          total={shown.length}
          loading={page.loading && !page.data}
          scrollKey="cobros-pagos"
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.cobros.noMatch : copy.cobros.movementsEmpty}
              description={filtersActive ? undefined : copy.cobros.movementsEmptyHint}
            />
          }
        />
      )}
      <PagoDrawer
        me={me}
        id={openId}
        names={names}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          setOpenId(null)
          page.reload()
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
          page.reload()
        }}
      />
    </CobrosFrame>
  )
}

function PagoDrawer({
  me,
  id,
  names,
  onClose,
  onChanged,
}: {
  me: Me
  id: string | null
  names: NameMap
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
  const name = payment?.counterparty_id ? names[payment.counterparty_id] ?? '…' : '—'

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
