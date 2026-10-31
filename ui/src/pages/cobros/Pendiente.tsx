import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { ErrorState } from '@/components/ErrorState'
import { Badge, Button, Chip, DataGrid, EmptyState, Input, useToast, type GridAggregation, type GridColumn } from '@/ui'
import { Search } from '@/ui/icons'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { receivablesPath, type MoneyBuckets, type ReceivableGroup, type ReceivableItem, type Receivables } from '@/lib/finance'
import { allows } from '@/lib/permissions'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { CobrosFrame } from '@/pages/cobros/CobrosFrame'
import { vistaOf } from '@/pages/cobros/vista'
import { centsOf, entityLabel, gridLabels, moneyOf, sumItems, textFromCents } from '@/pages/cobros/money'
import { RegistrarDialog } from '@/pages/cobros/RegistrarDialog'

type Row = {
  id: string
  contact_id: string | null
  customer_name: string
  legal_entity_id: string
  amounts: MoneyBuckets
  items: ReceivableItem[]
  holded: boolean
}

const AGING = [
  { id: '', label: copy.cobros.agingAll },
  { id: '0-30', label: copy.cobros.bucket030 },
  { id: '31-60', label: copy.cobros.bucket3160 },
  { id: '61-90', label: copy.cobros.bucket6190 },
  { id: '>90', label: copy.cobros.bucket90 },
] as const

export function Pendiente({ me }: { me: Me }) {
  const { entityCode } = useEntity()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const aging = params.get('aging') ?? ''
  const vista = vistaOf(params.get('vista'))
  const [q, setQ] = useState('')
  const [widths, setWidths] = useState<Record<string, number>>({
    customer: 240,
    entity: 88,
    origin: 96,
    b030: 148,
    b3160: 148,
    b6190: 140,
    b90: 140,
    total: 150,
  })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [aggregation, setAggregation] = useState<Record<string, GridAggregation | undefined>>({
    b030: 'sum',
    b3160: 'sum',
    b6190: 'sum',
    b90: 'sum',
    total: 'sum',
  })
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<{ contactId: string | null; entityId: string | null }>({ contactId: null, entityId: null })
  const canWrite = allows(me, 'finance.write')
  const showEntity = entityCode === null && me.entities.length > 1
  const data = useApi<Receivables>(receivablesPath(entityCode, aging || null))

  const rows = useMemo(() => rowsOf(data.data?.groups ?? []), [data.data])
  const query = q.trim().toLocaleLowerCase('es')
  const shown = useMemo(() => {
    const filtered = query ? rows.filter((row) => row.customer_name.toLocaleLowerCase('es').includes(query)) : rows
    const copyRows = [...filtered]
    copyRows.sort((left, right) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortBy === 'total') return dir * (centsOf(left.amounts.total) - centsOf(right.amounts.total))
      return dir * left.customer_name.localeCompare(right.customer_name, 'es')
    })
    return copyRows
  }, [query, rows, sortBy, sortDir])
  const totals = sumItems(shown.flatMap((row) => row.items))
  const byEntity = entitySums(shown, me)
  const filtersActive = Boolean(query || aging)
  const screen = data.loading ? 'cobros-cargando' : shown.length === 0 ? 'cobros-vacio' : 'cobros-pendiente'

  function setAging(next: string) {
    const queryParams = new URLSearchParams(params)
    if (next) queryParams.set('aging', next)
    else queryParams.delete('aging')
    setParams(queryParams, { replace: true })
  }

  const columns = useMemo<GridColumn<Row>[]>(() => {
    const money = (bucket: keyof MoneyBuckets) => (row: Row) => (
      <span className="tabular-nums">{moneyOf(row.amounts[bucket])}</span>
    )
    const list: GridColumn<Row>[] = [
      { id: 'customer', header: copy.cobros.customer, sortable: true, cell: (row) => row.customer_name },
    ]
    if (showEntity) {
      list.push({ id: 'entity', header: copy.cobros.entity, cell: (row) => entityLabel(row.legal_entity_id, me.entities) })
    }
    if (rows.some((row) => row.holded)) {
      list.push({
        id: 'origin',
        header: copy.cobros.origin,
        cell: (row) => (row.holded ? <Badge size="sm">{copy.cobros.holded}</Badge> : '—'),
      })
    }
    list.push(
      { id: 'b030', header: copy.cobros.bucket030, align: 'right', aggregations: ['sum'], cell: money('0-30') },
      { id: 'b3160', header: copy.cobros.bucket3160, align: 'right', aggregations: ['sum'], cell: money('31-60') },
      { id: 'b6190', header: copy.cobros.bucket6190, align: 'right', aggregations: ['sum'], cell: money('61-90') },
      { id: 'b90', header: copy.cobros.bucket90, align: 'right', aggregations: ['sum'], cell: money('>90') },
      { id: 'total', header: copy.cobros.total, align: 'right', sortable: true, aggregations: ['sum'], cell: money('total') },
    )
    return list
  }, [me.entities, rows, showEntity])

  const aggregationValues = {
    b030: moneyOf(totals['0-30']),
    b3160: moneyOf(totals['31-60']),
    b6190: moneyOf(totals['61-90']),
    b90: moneyOf(totals['>90']),
    total: moneyOf(totals.total),
  }

  return (
    <CobrosFrame
      screen={screen}
      vista={vista}
      action={canWrite ? { label: copy.cobros.register, onClick: () => { setPreset({ contactId: null, entityId: null }); setOpen(true) } } : null}
      toolbar={
        <Input
          id="buscar-cobros"
          size="sm"
          type="search"
          value={q}
          placeholder={copy.cobros.searchCustomers}
          aria-label={copy.cobros.searchCustomers}
          className="w-56 shrink-0"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          onChange={(event) => setQ(event.target.value)}
        />
      }
      filters={
        <>
          {AGING.map((pill) => (
            <Chip key={pill.label} pressed={aging === pill.id} active={aging === pill.id} onClick={() => setAging(aging === pill.id ? '' : pill.id)}>
              {pill.label}
            </Chip>
          ))}
        </>
      }
    >
      {data.error && !data.data ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />
        </div>
      ) : (
        <>
          {byEntity.length > 1 ? (
            <div className="flex h-10 shrink-0 items-center gap-4 overflow-x-auto border-b border-border-subtle px-3 sm:px-4">
              {byEntity.map((item) => (
                <span key={item.id} className="shrink-0 text-caption text-text-tertiary">
                  {item.label} <span className="text-label tabular-nums text-ink-900">{moneyOf(item.total)}</span>
                </span>
              ))}
            </div>
          ) : null}
          <DataGrid
            columns={columns}
            rows={shown}
            rowKey={(row) => row.id}
            labels={gridLabels(copy.cobros.grid.openRecord)}
            widths={widths}
            onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={(column, dir) => {
              setSortBy(column)
              setSortDir(dir)
            }}
            selected={picked}
            onSelectedChange={setPicked}
            onOpenRow={(row) => {
              setPreset({ contactId: row.contact_id, entityId: row.legal_entity_id })
              setOpen(true)
            }}
            openRowKey={open && preset.contactId ? `${preset.contactId}:${preset.entityId ?? ''}` : null}
            aggregation={aggregation}
            onAggregationChange={(column, kind) => setAggregation((current) => ({ ...current, [column]: kind ?? undefined }))}
            aggregationValues={aggregationValues}
            total={shown.length}
            loading={data.loading && !data.data}
            scrollKey="cobros-pendiente"
            empty={
              <EmptyState
                size="sm"
                title={filtersActive ? copy.cobros.noMatch : data.data?.status === 'clear' ? copy.cobros.clear : copy.cobros.empty}
                description={filtersActive ? undefined : copy.cobros.emptyHint}
                action={
                  canWrite && !filtersActive ? (
                    <Button type="button" variant="primary" size="sm" onClick={() => { setPreset({ contactId: null, entityId: null }); setOpen(true) }}>
                      {copy.cobros.register}
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </>
      )}
      <RegistrarDialog
        me={me}
        open={open}
        direction="in"
        contactId={preset.contactId}
        entityId={preset.entityId}
        onClose={() => setOpen(false)}
        onSaved={(warnings) => {
          setOpen(false)
          const warning = warnings[0]
          toast(copy.cobros.saved, warning ? { tone: 'warning', description: warning } : { tone: 'success' })
          data.reload()
        }}
      />
    </CobrosFrame>
  )
}

function rowsOf(groups: ReceivableGroup[]): Row[] {
  const rows: Row[] = []
  for (const group of groups) {
    const byEntity = new Map<string, ReceivableItem[]>()
    for (const item of group.items) {
      const list = byEntity.get(item.legal_entity_id) ?? []
      list.push(item)
      byEntity.set(item.legal_entity_id, list)
    }
    for (const [legal, items] of byEntity) {
      rows.push({
        id: `${group.contact_id ?? 'none'}:${legal}`,
        contact_id: group.contact_id,
        customer_name: group.customer_name,
        legal_entity_id: legal,
        amounts: sumItems(items),
        items,
        holded: items.some((item) => Boolean(item.source_label)),
      })
    }
  }
  return rows
}

function entitySums(rows: Row[], me: Me) {
  const totals = new Map<string, number>()
  for (const row of rows) totals.set(row.legal_entity_id, (totals.get(row.legal_entity_id) ?? 0) + centsOf(row.amounts.total))
  return [...totals.entries()].map(([id, cents]) => ({
    id,
    label: entityLabel(id, me.entities),
    total: textFromCents(cents),
  }))
}
