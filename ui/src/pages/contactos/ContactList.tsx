import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Search, Users } from '@/ui/icons'
import {
  Button,
  Chip,
  DataGrid,
  EmptyState,
  GlassMenu,
  Input,
  MenuChip,
  MenuItem,
  Select,
  useMenuOpen,
  useToast,
  type GridColumn,
} from '@/ui'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import {
  COUNTRIES,
  countryLabel,
  exportContacts,
  listContacts,
  roleLabels,
  type ContactKind,
  type ContactQuery,
  type ContactRole,
  type ContactSummary,
} from '@/lib/contacts'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { readStorage, writeStorage } from '@/lib/storage'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { ContactPreview } from '@/pages/contactos/ContactPreview'

const COLUMN_KEY = 'winecore.columns.contacts'
const COLUMN_IDS = ['legal_name', 'trade_name', 'tax_id', 'country', 'city', 'email', 'roles', 'updated'] as const
const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  legal_name: 'Nombre fiscal',
  trade_name: 'Nombre comercial',
  tax_id: 'NIF',
  country: 'País',
  city: 'Población',
  email: 'Correo',
  roles: 'Papel',
  updated: 'Actualizado',
}
type ColumnId = (typeof COLUMN_IDS)[number]
const DEFAULT_HIDDEN = new Set<ColumnId>(['trade_name', 'email', 'updated'])

const GRID_LABELS = {
  addCalculation: 'Añadir cálculo',
  aggregation: () => 'Cálculo',
  aggregations: 'Cálculos',
  count: (n: number) => `${n}`,
  clearCalculation: 'Quitar cálculo',
  selectAll: 'Seleccionar todos',
  selectRow: 'Seleccionar fila',
  openRecord: 'Abrir contacto',
  sortAscending: 'Ascendente',
  sortDescending: 'Descendente',
  columnOptions: 'Opciones de columna',
}

function readHidden(): Set<ColumnId> {
  const raw = readStorage(COLUMN_KEY)
  if (!raw) return new Set(DEFAULT_HIDDEN)
  try {
    const parsed = JSON.parse(raw) as ColumnId[]
    return new Set(parsed.filter((id) => COLUMN_IDS.includes(id)))
  } catch {
    return new Set(DEFAULT_HIDDEN)
  }
}

const KIND_PILLS: { id: '' | ContactKind; label: string }[] = [
  { id: '', label: 'Todos' },
  { id: 'company', label: 'Empresas' },
  { id: 'person', label: 'Personas' },
]

const ROLE_PILLS: { id: ContactRole; label: string }[] = [
  { id: 'customer', label: 'Clientes' },
  { id: 'supplier', label: 'Proveedores' },
  { id: 'carrier', label: 'Transportistas' },
  { id: 'logistics_operator', label: 'Operadores logísticos' },
]

export function ContactList({ me }: { me: Me }) {
  useChromeTitle(copy.contacts.title)
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const [params, setParams] = useSearchParams()
  const { filter } = useEntity()
  const entity = filter === 'PO' || filter === 'CVPO' ? filter : ''
  const canWrite = allows(me, 'contacts.write')
  const kind = (params.get('kind') ?? '') as '' | ContactKind
  const role = (params.get('role') ?? '') as '' | ContactRole
  const country = params.get('country') ?? ''
  const archived = params.get('archived') === 'true'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [debounced, setDebounced] = useState(q)
  const [items, setItems] = useState<ContactSummary[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ legal_name: 280, tax_id: 140, roles: 200 })

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const query = useMemo<ContactQuery>(
    () => ({ q: debounced, kind, role, country, entity, archived, limit: 50 }),
    [archived, country, debounced, entity, kind, role],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    listContacts(query, controller.signal)
      .then((page) => {
        if (!active) return
        setItems(page.items)
        setTotal(page.total)
        setCursor(page.next_cursor)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [query, attempt])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
    setLoading(true)
  }

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listContacts({ ...query, cursor })
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setTotal(page.total)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      setLoadingMore(false)
    }
  }

  function toggleColumn(id: ColumnId) {
    if (id === 'legal_name') return
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(COLUMN_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const columns = useMemo<GridColumn<ContactSummary>[]>(() => {
    const all: GridColumn<ContactSummary>[] = [
      { id: 'legal_name', header: 'Nombre fiscal', cell: (row) => row.legal_name },
      { id: 'trade_name', header: 'Nombre comercial', cell: (row) => row.trade_name || '—' },
      { id: 'tax_id', header: 'NIF', cell: (row) => row.tax_id || '—' },
      { id: 'country', header: 'País', cell: (row) => countryLabel(row.country_code) },
      { id: 'city', header: 'Población', cell: (row) => row.city || '—' },
      { id: 'email', header: 'Correo', cell: (row) => row.email || '—' },
      { id: 'roles', header: 'Papel', cell: (row) => roleLabels(row).join(' · ') || '—' },
      { id: 'updated', header: 'Actualizado', cell: (row) => formatDate(row.updated_at) },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [hidden])

  const selectedIndex = items.findIndex((item) => item.id === selected)
  const filtersActive = Boolean(debounced || kind || role || country || archived)
  const emptyTitle = filtersActive ? copy.contacts.noMatch : copy.contacts.empty
  const screen = loading ? 'contactos-cargando' : items.length === 0 && !filtersActive ? 'contactos-vacio' : 'contactos'

  if (!allows(me, 'contacts.read')) return <NoPermission />

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Users className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.contacts.title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void exportContacts(query).catch(() => toast('No se ha podido exportar.'))
            }}
          >
            {copy.contacts.export}
          </Button>
          {canWrite ? (
            <Button type="button" variant="primary" size="sm" onClick={() => navigate('/contactos/nuevo')}>
              {copy.contacts.new}
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="buscar-contactos"
            size="sm"
            type="search"
            value={q}
            placeholder={copy.contacts.search}
            aria-label={copy.contacts.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
            onChange={(event) => setQ(event.target.value)}
          />
          <GlassMenu
            open={columnsMenu.open}
            onOpenChange={columnsMenu.setOpen}
            placement="bottom-start"
            panelClassName="min-w-[200px]"
            trigger={
              <MenuChip active={columnsMenu.open} onClick={columnsMenu.toggle} title={copy.contacts.columns}>
                {copy.contacts.columns}
              </MenuChip>
            }
          >
            {COLUMN_IDS.map((id) => (
              <MenuItem
                key={id}
                checked={!hidden.has(id)}
                disabled={id === 'legal_name'}
                onClick={() => toggleColumn(id)}
              >
                {COLUMN_LABELS[id]}
              </MenuItem>
            ))}
          </GlassMenu>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          {canWrite ? (
            <Button type="button" variant="primary" size="sm" onClick={() => navigate('/contactos/nuevo')}>
              {copy.contacts.new}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {KIND_PILLS.map((pill) => (
            <Chip key={pill.label} pressed={kind === pill.id} active={kind === pill.id} onClick={() => setFilter('kind', pill.id)}>
              {pill.label}
            </Chip>
          ))}
          {ROLE_PILLS.map((pill) => (
            <Chip
              key={pill.id}
              pressed={role === pill.id}
              active={role === pill.id}
              onClick={() => setFilter('role', role === pill.id ? '' : pill.id)}
            >
              {pill.label}
            </Chip>
          ))}
          <Select
            id="filtro-pais"
            size="sm"
            aria-label="País"
            value={country}
            onChange={(event) => setFilter('country', event.target.value)}
          >
            <option value="">País</option>
            {COUNTRIES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </Select>
          <Chip pressed={archived} active={archived} onClick={() => setFilter('archived', archived ? '' : 'true')}>
            {copy.contacts.archived}
          </Chip>
        </div>
      </div>

      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState
            title={`${copy.error.load} (${error.code})`}
            detail={error.message}
            onRetry={() => {
              setLoading(true)
              setAttempt((value) => value + 1)
            }}
          />
        </div>
      ) : (
        <DataGrid
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          labels={GRID_LABELS}
          widths={widths}
          onResize={(id, width) => setWidths((current) => ({ ...current, [id]: width }))}
          selected={picked}
          onSelectedChange={setPicked}
          onOpenRow={(row) => setSelected(row.id)}
          rowHref={(row) => `/contactos/${row.id}`}
          openRowKey={selected}
          total={total}
          loading={loading}
          empty={
            <EmptyState
              size="sm"
              title={emptyTitle}
              description={filtersActive ? undefined : copy.contacts.emptyHint}
              action={
                canWrite && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => navigate('/contactos/nuevo')}>
                    {copy.contacts.new}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {cursor ? (
        <div className={cn('flex h-10 shrink-0 items-center border-t border-border-subtle', FRAME_GUTTER)}>
          <Button type="button" variant="ghost" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
            {copy.table.loadMore}
          </Button>
        </div>
      ) : null}

      <ContactPreview
        id={selected}
        ids={items.map((item) => item.id)}
        index={selectedIndex}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onSelect={setSelected}
      />
    </div>
  )
}
