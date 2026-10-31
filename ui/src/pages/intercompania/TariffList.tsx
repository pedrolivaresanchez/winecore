import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { createTariff } from '@/pages/intercompania/api'
import { ListFrame } from '@/pages/intercompania/frame'
import {
  baseListOptions,
  discountLabel,
  emptyDraft,
  fold,
  formatCivil,
  GRID_LABELS,
  isOwner,
  overlappingActive,
  tariffStatusLabel,
  tariffTone,
  windowLabel,
  type Tariff,
  type TariffDraft,
  type TariffStatus,
} from '@/pages/intercompania/model'
import { TariffDialog } from '@/pages/intercompania/TariffDialog'
import { Search } from '@/ui/icons'
import { iconStroke } from '@/lib/motion'
import {
  Badge,
  Button,
  Chip,
  DataGrid,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  useMenuOpen,
  useToast,
  type GridColumn,
} from '@/ui'

const COLUMN_IDS = ['window', 'discount', 'until', 'status', 'advisor'] as const
type ColumnId = (typeof COLUMN_IDS)[number]

const FILTERS: { id: '' | TariffStatus; label: string }[] = [
  { id: '', label: copy.intercompany.all },
  { id: 'draft', label: copy.intercompany.drafts },
  { id: 'active', label: copy.intercompany.active },
  { id: 'retired', label: copy.intercompany.retired },
]

export function TariffList({ me }: { me: Me }) {
  const tariffs = useApi<{ items: Tariff[] }>('/v1/intercompany/tariffs')
  if (!allows(me, 'billing.read')) return <NoPermission />
  if (tariffs.error && !tariffs.data) {
    return (
      <div className="p-4">
        <ErrorState
          title={`${copy.error.load} (${tariffs.error.code})`}
          detail={tariffs.error.message}
          onRetry={tariffs.reload}
        />
      </div>
    )
  }
  return <Loaded me={me} items={tariffs.data?.items ?? []} loading={tariffs.loading && !tariffs.data} onCreated={tariffs.reload} />
}

function Loaded({
  me,
  items,
  loading,
  onCreated,
}: {
  me: Me
  items: Tariff[]
  loading: boolean
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const owner = isOwner(me)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | TariffStatus>('')
  const [hidden, setHidden] = useState<Set<ColumnId>>(new Set())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({ window: 280, advisor: 240, discount: 120 })
  const [dialog, setDialog] = useState<{ key: number; draft: TariffDraft } | null>(null)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const query = fold(q.trim())
    return [...items]
      .filter((tariff) => (status ? tariff.status === status : true))
      .filter((tariff) => {
        if (!query) return true
        const haystack = fold(`${windowLabel(tariff)} ${tariff.discount_pct} ${tariff.advisor_validation} ${tariffStatusLabel(tariff.status)}`)
        return haystack.includes(query)
      })
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from) || a.id.localeCompare(b.id))
  }, [items, q, status])

  const columns = useMemo<GridColumn<Tariff>[]>(() => {
    const all: GridColumn<Tariff>[] = [
      { id: 'window', header: copy.intercompany.validFrom, cell: (row) => windowLabel(row) },
      {
        id: 'discount',
        header: copy.intercompany.discount,
        align: 'right',
        cell: (row) => discountLabel(row.discount_pct),
      },
      {
        id: 'until',
        header: copy.intercompany.validTo,
        cell: (row) => (row.valid_to ? formatCivil(row.valid_to) : copy.intercompany.openEnded),
      },
      {
        id: 'status',
        header: copy.intercompany.status,
        cell: (row) => {
          const clash = overlappingActive(row, items)
          return (
            <span className="flex min-w-0 items-center gap-1">
              <Badge tone={tariffTone(row.status)} size="sm">
                {tariffStatusLabel(row.status)}
              </Badge>
              {clash ? (
                <Badge tone="warning" size="sm">
                  {copy.intercompany.overlapChip}
                </Badge>
              ) : null}
            </span>
          )
        },
      },
      { id: 'advisor', header: copy.intercompany.advisor, cell: (row) => row.advisor_validation },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [hidden, items])

  const filtersActive = Boolean(q.trim() || status)
  const empty = !loading && filtered.length === 0
  const screen = loading ? 'intercompania-tarifas-cargando' : empty ? 'intercompania-tarifas-vacio' : 'intercompania-tarifas'

  function openCreate() {
    const lists = baseListOptions(items)
    setDialog({ key: Date.now(), draft: emptyDraft(lists[0] ?? '') })
  }

  return (
    <>
      <ListFrame
        screen={screen}
        object="tarifas"
        actions={
          owner ? (
            <Button type="button" variant="primary" size="sm" onClick={openCreate}>
              {copy.intercompany.newTariff}
            </Button>
          ) : null
        }
        mobileActions={
          owner ? (
            <Button type="button" variant="primary" size="sm" onClick={openCreate}>
              {copy.intercompany.newTariff}
            </Button>
          ) : null
        }
        toolbar={
          <>
            <Input
              id="buscar-tarifas"
              size="sm"
              type="search"
              value={q}
              placeholder={copy.intercompany.searchTariff}
              aria-label={copy.intercompany.searchTariff}
              className="w-36 shrink-0 sm:w-56"
              prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
              onChange={(event) => setQ(event.target.value)}
            />
            <GlassMenu
              open={columnsMenu.open}
              onOpenChange={columnsMenu.setOpen}
              placement="bottom-start"
              panelClassName="min-w-[200px]"
              trigger={
                <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.intercompany.columns}>
                  {copy.intercompany.columns}
                </MenuChip>
              }
            >
              {COLUMN_IDS.map((id) => (
                <MenuItem
                  key={id}
                  checked={!hidden.has(id)}
                  disabled={id === 'window'}
                  onClick={() =>
                    setHidden((current) => {
                      const next = new Set(current)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }
                >
                  {id === 'window'
                    ? copy.intercompany.validFrom
                    : id === 'discount'
                      ? copy.intercompany.discount
                      : id === 'until'
                        ? copy.intercompany.validTo
                        : id === 'status'
                          ? copy.intercompany.status
                          : copy.intercompany.advisor}
                </MenuItem>
              ))}
            </GlassMenu>
          </>
        }
        filters={FILTERS.map((pill) => (
          <Chip key={pill.label} pressed={status === pill.id} active={status === pill.id} onClick={() => setStatus(pill.id)}>
            {pill.label}
          </Chip>
        ))}
      >
        <DataGrid
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          rowHref={(row) => `/intercompania/tarifas/${row.id}`}
          onOpenRow={(row) => navigate(`/intercompania/tarifas/${row.id}`)}
          total={filtered.length}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={filtersActive ? copy.intercompany.noMatch : copy.intercompany.emptyTariffs}
              description={filtersActive ? undefined : copy.intercompany.emptyTariffsHint}
              action={
                owner && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={openCreate}>
                    {copy.intercompany.newTariff}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </ListFrame>
      {dialog ? (
        <TariffDialog
          key={dialog.key}
          open
          title={copy.intercompany.newTariff}
          initial={dialog.draft}
          baseLists={baseListOptions(items)}
          busy={saving}
          onClose={() => {
            if (!saving) setDialog(null)
          }}
          onSubmit={async (input) => {
            setSaving(true)
            try {
              const created = await createTariff(input)
              toast(copy.intercompany.created)
              setDialog(null)
              onCreated()
              navigate(`/intercompania/tarifas/${created.id}`)
            } catch (error: unknown) {
              if (!(error instanceof ApiError && error.fields)) {
                toast(error instanceof ApiError ? error.message : copy.api.generic, { tone: 'danger' })
              }
              throw error
            } finally {
              setSaving(false)
            }
          }}
        />
      ) : null}
    </>
  )
}
