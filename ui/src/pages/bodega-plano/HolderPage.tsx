import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import type { LotListItem } from '@/lib/cellar'
import { formatDateTime, formatInteger, formatLitres } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Fact, FactCard, FillMeter, ReadingColumn, RecordBar, SectionTabs } from '@/pages/bodega/chrome'
import { postHolderMove } from '@/pages/bodega-plano/api'
import { pctOf } from '@/pages/bodega-plano/geom'
import { holderKindLabel, packagedLabel } from '@/pages/bodega-plano/text'
import type { AuditItem, HolderView, PackagedState, Page } from '@/pages/bodega-plano/types'
import { Badge, Button, DatePicker, Dialog, DialogBody, DialogFooter, DialogHeader, EmptyState, InfoTip, Input, SegmentedControl, Select, Skeleton, useToast } from '@/ui'

const TABS = [
  { id: 'datos', label: copy.plano.data },
  { id: 'movimientos', label: copy.plano.moves },
] as const

type TabId = (typeof TABS)[number]['id']

const DATE_LABELS = { clear: copy.stock.dateClear, today: copy.stock.dateToday }

type MoveLine = {
  id: number
  qty: number
  state: string
  lotId: string
  at: string
}

type ProductOption = { id: string; name: string; sku: string; kind: string }

function afterOf(item: AuditItem, field: string): unknown {
  return item.changes.find((change) => change.field === field)?.after
}

function linesOf(items: AuditItem[], holderId: string): MoveLine[] {
  const lines: MoveLine[] = []
  for (const item of items) {
    if (item.action !== 'INSERT') continue
    const holder = String(afterOf(item, 'holder_id') ?? '')
    if (holder.toLowerCase() !== holderId.toLowerCase()) continue
    const qty = Number(afterOf(item, 'qty_units'))
    if (!Number.isFinite(qty) || qty === 0) continue
    const occurred = afterOf(item, 'occurred_at')
    lines.push({
      id: item.id,
      qty,
      state: String(afterOf(item, 'product_state') ?? ''),
      lotId: String(afterOf(item, 'lot_id') ?? ''),
      at: typeof occurred === 'string' ? occurred : item.occurred_at,
    })
  }
  return lines
}

function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function stateTone(state: string): 'success' | 'neutral' | 'info' | 'warning' {
  if (state === 'packaged_labeled') return 'success'
  if (state === 'packaged_unlabeled') return 'info'
  if (state === 'mixed') return 'warning'
  return 'neutral'
}

export function HolderPage({ me }: { me: Me }) {
  const { code = '' } = useParams()
  const path = allows(me, 'cellar.read') && code ? `/v1/holders/${encodeURIComponent(code)}` : null
  const data = useApi<HolderView>(path)
  const [tab, setTab] = useState<TabId>('datos')
  const [moveOpen, setMoveOpen] = useState(false)
  useChromeTitle(data.data?.code || copy.plano.holders)

  if (!allows(me, 'cellar.read')) return <NoPermission />
  if (data.loading && !data.data) {
    return (
      <div aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-36" />
      </div>
    )
  }
  if (data.error || !data.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${data.error?.code ?? 'WC_ERROR'})`} detail={data.error?.message} onRetry={data.reload} />
      </div>
    )
  }

  return (
    <Loaded
      me={me}
      holder={data.data}
      tab={tab}
      onTab={setTab}
      moveOpen={moveOpen}
      onMove={setMoveOpen}
      onReload={data.reload}
    />
  )
}

function Loaded({
  me,
  holder,
  tab,
  onTab,
  moveOpen,
  onMove,
  onReload,
}: {
  me: Me
  holder: HolderView
  tab: TabId
  onTab: (tab: TabId) => void
  moveOpen: boolean
  onMove: (open: boolean) => void
  onReload: () => void
}) {
  const canOperate = allows(me, 'cellar.operate')
  const fill = pctOf(holder.fill_pct)
  const audit = useApi<Page<AuditItem>>(tab === 'movimientos' ? '/v1/audit?table=cellar.holder_move&limit=100' : null)
  const lots = useApi<{ items: LotListItem[] }>(tab === 'movimientos' || moveOpen ? '/v1/lots?limit=100' : null)
  const products = useApi<Page<ProductOption>>(moveOpen ? '/v1/products?limit=100' : null)
  const lotName = useMemo(() => {
    const map = new Map<string, string>()
    for (const lot of lots.data?.items ?? []) map.set(lot.id.toLowerCase(), lot.code)
    if (holder.lot_id && holder.lot_code) map.set(holder.lot_id.toLowerCase(), holder.lot_code)
    for (const balance of holder.balances) map.set(balance.lot_id.toLowerCase(), balance.lot_code)
    return map
  }, [holder, lots.data])
  const moves = audit.data ? linesOf(audit.data.items, holder.id) : []
  const denied = audit.error?.status === 403

  return (
    <ReadingColumn screen="bodega-contenedor" tab={tab}>
      <RecordBar backTo="/bodega/contenedores" backLabel={copy.plano.backHolders}>
        {canOperate ? (
          <Button type="button" variant="primary" size="sm" onClick={() => onMove(true)}>
            {copy.plano.register}
          </Button>
        ) : null}
      </RecordBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">
          <header>
            <h1 className="text-body font-medium break-words text-ink-900">{holder.code}</h1>
            <div className="mt-0.5 flex items-center gap-1 text-label text-text-secondary">
              <span className="min-w-0 truncate">
                {holder.name} · {holderKindLabel(holder.kind)}
              </span>
              {holder.kind === 'jaulon' ? <InfoTip label={copy.plano.jaulonRule}>{copy.plano.jaulonRule}</InfoTip> : null}
            </div>
          </header>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">{holderKindLabel(holder.kind)}</Badge>
            <Badge tone={stateTone(holder.state)}>{packagedLabel(holder.state)}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Metric label={copy.plano.capacity} value={holder.capacity_bottles == null ? '—' : formatInteger(holder.capacity_bottles)} />
            <Metric label={copy.plano.bottles} value={formatInteger(holder.count)} />
            <Metric label={copy.plano.fill} value={holder.fill_pct == null ? '—' : `${Math.round(fill)} %`} />
          </div>
          {holder.fill_pct != null ? <FillMeter pct={fill} label={`${copy.plano.fill} ${Math.round(fill)} %`} /> : null}
          <SectionTabs label={copy.plano.holders} tabs={TABS} value={tab} onChange={onTab} />

          {tab === 'datos' ? (
            <FactCard title={copy.plano.data}>
              <Fact label={copy.plano.kind} value={holderKindLabel(holder.kind)} />
              <Fact label={copy.plano.number} value={holder.number == null ? '—' : String(holder.number)} />
              <Fact label={copy.plano.format} value={holder.format || '—'} />
              <Fact
                label={copy.plano.nominal}
                value={holder.nominal_volume_ml == null ? '—' : formatLitres(holder.nominal_volume_ml / 1000)}
              />
              <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2">
                <dt className="text-caption text-text-tertiary">{copy.plano.lot}</dt>
                <dd className="text-label text-ink-900">
                  {holder.lot_code ? (
                    <Link to={`/bodega/lotes/${encodeURIComponent(holder.lot_code)}`} className="font-medium underline">
                      {holder.lot_code}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <Fact label={copy.plano.state} value={packagedLabel(holder.product_state ?? holder.state)} />
              {holder.notes ? <Fact label={copy.plano.notes} value={holder.notes} /> : null}
            </FactCard>
          ) : null}

          {tab === 'movimientos' ? (
            <Moves
              holder={holder}
              moves={moves}
              denied={denied}
              loading={audit.loading}
              error={denied ? null : audit.error}
              onRetry={audit.reload}
              lotName={lotName}
            />
          ) : null}
        </div>
      </div>
      <MoveDialog
        me={me}
        holder={holder}
        open={moveOpen}
        lots={lots.data?.items ?? []}
        products={(products.data?.items ?? []).filter((item) => item.kind === 'wine' || item.kind === 'bulk_wine')}
        onClose={() => onMove(false)}
        onSaved={() => {
          onReload()
          audit.reload()
          onTab('movimientos')
        }}
      />
    </ReadingColumn>
  )
}

function Moves({
  holder,
  moves,
  denied,
  loading,
  error,
  onRetry,
  lotName,
}: {
  holder: HolderView
  moves: MoveLine[]
  denied: boolean
  loading: boolean
  error: { code: string; message: string } | null
  onRetry: () => void
  lotName: Map<string, string>
}) {
  if (loading && moves.length === 0 && !denied) {
    return (
      <div aria-busy="true" className="grid gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    )
  }
  if (error) return <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={onRetry} />
  if (moves.length === 0) {
    return (
      <div className="grid gap-4">
        {holder.balances.length > 0 ? <BalanceList holder={holder} /> : null}
        <EmptyState size="sm" title={copy.plano.emptyMoves} description={denied ? undefined : copy.plano.emptyMovesHint} />
      </div>
    )
  }
  return (
    <ul className="grid gap-2">
      {moves.map((move) => {
        const lot = lotName.get(move.lotId.toLowerCase())
        return (
          <li key={move.id} className="rounded-2xl border border-border-subtle px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-label font-medium text-ink-900 tabular-nums">
                {move.qty > 0 ? '+' : '−'}
                {formatInteger(Math.abs(move.qty))}
              </p>
              <Badge tone={stateTone(move.state)} size="sm">
                {packagedLabel(move.state)}
              </Badge>
            </div>
            <p className="mt-1 text-caption text-text-tertiary">
              {formatDateTime(move.at)}
              {lot ? ` · ${lot}` : ''}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

function BalanceList({ holder }: { holder: HolderView }) {
  return (
    <FactCard title={copy.plano.balance}>
      {holder.balances.map((balance) => (
        <Fact
          key={`${balance.lot_id}-${balance.product_state}`}
          label={balance.lot_code}
          value={`${formatInteger(balance.qty_units)} · ${packagedLabel(balance.product_state)}`}
        />
      ))}
    </FactCard>
  )
}

function MoveDialog({
  me,
  holder,
  open,
  lots,
  products,
  onClose,
  onSaved,
}: {
  me: Me
  holder: HolderView
  open: boolean
  lots: LotListItem[]
  products: ProductOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const ownerDefault = me.entities.find((entity) => entity.code === 'PO')?.id ?? me.entities[0]?.id ?? ''
  const [owner, setOwner] = useState(ownerDefault)
  const [lotId, setLotId] = useState('')
  const [productId, setProductId] = useState('')
  const [state, setState] = useState<PackagedState>('packaged_unlabeled')
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [qty, setQty] = useState('')
  const [day, setDay] = useState<string | null>(madridToday())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lockedState = holder.kind === 'jaulon'
  const chosenLot = lotId || lots[0]?.id || ''
  const chosenProduct = productId || products[0]?.id || ''
  const bottles = Number(qty)
  const ready = Boolean(owner && chosenLot && chosenProduct && day && Number.isInteger(bottles) && bottles > 0)

  useEffect(() => {
    if (!open) return
    setError(null)
    setState('packaged_unlabeled')
    setDirection('in')
  }, [open])

  async function submit() {
    if (!day || !ready) return
    setBusy(true)
    setError(null)
    try {
      await postHolderMove(holder.code, {
        occurred_at: `${day}T08:00:00Z`,
        owner_entity_id: owner,
        lot_id: chosenLot,
        product_id: chosenProduct,
        product_state: lockedState ? 'packaged_unlabeled' : state,
        qty_units: direction === 'in' ? bottles : -bottles,
      })
      toast(copy.plano.moveSaved)
      setQty('')
      onSaved()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.plano.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="movimiento-soporte" size="sm">
      <DialogHeader titleId="movimiento-soporte" title={copy.plano.register} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3">
          <Field id="mov-entidad" label={copy.plano.entity}>
            <Select id="mov-entidad" className="w-full" value={owner} onChange={(event) => setOwner(event.target.value)}>
              {me.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mov-lote" label={copy.plano.lot}>
            <Select id="mov-lote" className="w-full" value={chosenLot} onChange={(event) => setLotId(event.target.value)}>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mov-producto" label={copy.plano.product}>
            <Select id="mov-producto" className="w-full" value={chosenProduct} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="mov-estado" label={copy.plano.state}>
            <Select
              id="mov-estado"
              className="w-full"
              value={lockedState ? 'packaged_unlabeled' : state}
              disabled={lockedState}
              onChange={(event) => setState(event.target.value as PackagedState)}
            >
              <option value="packaged_unlabeled">{copy.plano.unlabeled}</option>
              {lockedState ? null : <option value="packaged_labeled">{copy.plano.labeled}</option>}
            </Select>
          </Field>
          <SegmentedControl
            aria-label={copy.plano.direction}
            size="sm"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'in', content: copy.plano.entry },
              { value: 'out', content: copy.plano.exit },
            ]}
          />
          <Field id="mov-qty" label={copy.plano.qty}>
            <Input id="mov-qty" inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value)} />
          </Field>
          <Field id="mov-fecha" label={copy.plano.when}>
            <DatePicker value={day} onChange={setDay} labels={DATE_LABELS} locale="es" />
          </Field>
          {error ? (
            <p role="alert" className="text-label text-danger-600">
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {copy.plano.cancel}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={busy} disabled={!ready} onClick={() => void submit()}>
          {copy.plano.register}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-subtle px-3 py-2">
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="text-label font-medium break-words text-ink-900 tabular-nums">{value}</p>
    </div>
  )
}
