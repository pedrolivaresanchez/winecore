import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEntity } from '@/app/entity-context'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { NoPermission } from '@/components/NoPermission'
import { FRAME_GUTTER } from '@/ui/frame'
import { Archive, DownloadSimple, Undo2, Users } from '@/ui/icons'
import {
  Button,
  DataGrid,
  EmptyState,
  FilterBar,
  GlassMenu,
  MenuChip,
  MenuItem,
  Pagination,
  StatusPill,
  useCursorPages,
  useGridFilterLink,
  useMenuOpen,
  useToast,
  type FilterDef,
  type FilterValue,
  type GridColumn,
  type SelectionAction,
} from '@/ui'
import { copy, fill } from '@/i18n'
import { ApiError } from '@/lib/api'
import {
  COUNTRIES,
  archiveContact,
  countryLabel,
  exportContacts,
  listContacts,
  roleLabels,
  unarchiveContact,
  type ContactKind,
  type ContactQuery,
  type ContactRole,
  type ContactSummary,
} from '@/lib/contacts'
import { downloadCsv } from '@/lib/csv'
import { formatDate } from '@/lib/format'
import { allows } from '@/lib/permissions'
import { contactRoleTone } from '@/lib/status-tones'
import { readStorage, writeStorage } from '@/lib/storage'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { Me } from '@/lib/types'
import { ContactCreate } from '@/pages/contactos/ContactCreate'
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

const text = copy.lists.contacts

const ROLES: { id: ContactRole; label: string }[] = [
  { id: 'customer', label: text.roles.customer },
  { id: 'supplier', label: text.roles.supplier },
  { id: 'carrier', label: text.roles.carrier },
  { id: 'logistics_operator', label: text.roles.logistics_operator },
]

const FILTERS: FilterDef[] = [
  {
    id: 'kind',
    label: text.kind,
    kind: 'single',
    display: 'chips',
    options: [
      { value: 'company', label: text.companies },
      { value: 'person', label: text.people },
    ],
  },
  {
    id: 'role',
    label: text.role,
    kind: 'single',
    options: ROLES.map((role) => ({ value: role.id, label: role.label, tone: contactRoleTone(role.id) })),
  },
  {
    id: 'country',
    label: text.country,
    kind: 'single',
    options: COUNTRIES.map((item) => ({ value: item.code, label: item.label })),
  },
  { id: 'archived', label: copy.contacts.archived, kind: 'toggle' },
]

function roleIds(row: ContactSummary): ContactRole[] {
  const ids: ContactRole[] = []
  if (row.is_customer) ids.push('customer')
  if (row.is_supplier) ids.push('supplier')
  if (row.is_carrier) ids.push('carrier')
  if (row.is_logistics_operator) ids.push('logistics_operator')
  return ids
}

export function ContactList({ me, creating = false }: { me: Me; creating?: boolean }) {
  useChromeTitle(copy.contacts.title)
  const navigate = useNavigate()
  const toast = useToast()
  const columnsMenu = useMenuOpen()
  const gridFilters = useGridFilterLink()
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
  const [selected, setSelected] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState(readHidden)
  const [widths, setWidths] = useState<Record<string, number>>({ legal_name: 280, tax_id: 140, roles: 220 })

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [q])

  const query = useMemo<ContactQuery>(
    () => ({ q: debounced, kind, role, country, entity, archived }),
    [archived, country, debounced, entity, kind, role],
  )

  const pages = useCursorPages<ContactSummary>({
    queryKey: JSON.stringify(query),
    storageKey: 'contacts',
    fetchPage: ({ cursor, limit, signal }) => listContacts({ ...query, cursor: cursor ?? undefined, limit }, signal),
  })
  const items = pages.items
  const loading = pages.loading && items.length === 0
  const error = pages.error ? (pages.error instanceof ApiError ? pages.error : new ApiError(0, 'WC_ERROR', copy.error.load)) : null

  useEffect(() => {
    setPicked(new Set())
  }, [pages.pageKey])

  function setFilter(key: string, value: FilterValue) {
    const next = new URLSearchParams(params)
    if (value === true) next.set(key, 'true')
    else if (typeof value === 'string' && value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  function clearFilters() {
    const next = new URLSearchParams(params)
    for (const key of ['kind', 'role', 'country', 'archived', 'q']) next.delete(key)
    setParams(next)
    setQ('')
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
      { id: 'legal_name', header: COLUMN_LABELS.legal_name, cell: (row) => row.legal_name },
      { id: 'trade_name', header: COLUMN_LABELS.trade_name, cell: (row) => row.trade_name || '—' },
      { id: 'tax_id', header: COLUMN_LABELS.tax_id, cell: (row) => row.tax_id || '—' },
      { id: 'country', header: COLUMN_LABELS.country, cell: (row) => countryLabel(row.country_code) },
      { id: 'city', header: COLUMN_LABELS.city, cell: (row) => row.city || '—' },
      { id: 'email', header: COLUMN_LABELS.email, cell: (row) => row.email || '—' },
      {
        id: 'roles',
        header: COLUMN_LABELS.roles,
        filterValue: (row) => roleLabels(row).join(' · '),
        cell: (row) => {
          const ids = roleIds(row)
          if (ids.length === 0) return '—'
          return (
            <span className="flex items-center gap-1">
              {ids.map((id) => (
                <StatusPill key={id} tone={contactRoleTone(id)}>
                  {ROLES.find((item) => item.id === id)?.label}
                </StatusPill>
              ))}
            </span>
          )
        },
      },
      { id: 'updated', header: COLUMN_LABELS.updated, cell: (row) => formatDate(row.updated_at) },
    ]
    return all.filter((column) => !hidden.has(column.id as ColumnId))
  }, [hidden])

  const chosen = items.filter((item) => picked.has(item.id))

  async function setArchived(next: boolean) {
    const ids = chosen.map((item) => item.id)
    const results = await Promise.allSettled(ids.map((id) => (next ? archiveContact(id) : unarchiveContact(id))))
    const done = results.filter((result) => result.status === 'fulfilled').length
    if (done === ids.length) toast(fill(next ? text.archivedDone : text.unarchivedDone, { n: String(done) }))
    else toast(fill(copy.lists.bulk.partial, { done: String(done), n: String(ids.length) }))
    setPicked(new Set())
    pages.reload()
  }

  function exportSelection() {
    downloadCsv(
      'contactos-seleccion.csv',
      COLUMN_IDS.map((id) => COLUMN_LABELS[id]),
      chosen.map((row) => [
        row.legal_name,
        row.trade_name,
        row.tax_id,
        countryLabel(row.country_code),
        row.city,
        row.email,
        roleLabels(row).join(' · '),
        formatDate(row.updated_at),
      ]),
    )
    toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }))
  }

  const actions: SelectionAction[] = [
    ...(canWrite
      ? [
          archived
            ? {
                id: 'unarchive',
                label: copy.lists.bulk.unarchive,
                icon: Undo2,
                onRun: () => setArchived(false),
              }
            : {
                id: 'archive',
                label: copy.lists.bulk.archive,
                icon: Archive,
                confirm: {
                  title: fill(text.archiveTitle, { n: String(chosen.length) }),
                  body: text.archiveBody,
                  confirmLabel: copy.lists.bulk.archive,
                },
                onRun: () => setArchived(true),
              },
        ]
      : []),
    { id: 'export', label: copy.lists.bulk.exportCsv, icon: DownloadSimple, onRun: exportSelection },
  ]

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
            <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              {copy.contacts.new}
            </Button>
          ) : null}
        </div>
      </header>

      <FilterBar
        search={{ id: 'buscar-contactos', value: q, onChange: setQ, placeholder: copy.contacts.search }}
        filters={FILTERS}
        values={{ kind, role, country, archived }}
        onChange={setFilter}
        onClear={clearFilters}
        grid={gridFilters}
        selection={{
          count: picked.size,
          pageCount: items.length,
          onSelectAll: () => setPicked(new Set(items.map((item) => item.id))),
          onClear: () => setPicked(new Set()),
          actions,
        }}
        trailing={
          <>
            <GlassMenu
              open={columnsMenu.open}
              onOpenChange={columnsMenu.setOpen}
              placement="bottom-end"
              className="max-md:hidden"
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
            {canWrite ? (
              <Button type="button" variant="primary" size="sm" className="md:hidden" onClick={() => navigate('/contactos/nuevo')}>
                {copy.contacts.new}
              </Button>
            ) : null}
          </>
        }
      />

      {error && items.length === 0 ? (
        <div className="p-4">
          <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={pages.reload} />
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
          total={pages.total ?? undefined}
          loading={pages.loading}
          filterLink={gridFilters}
          empty={
            <EmptyState
              size="sm"
              title={emptyTitle}
              description={filtersActive ? undefined : copy.contacts.emptyHint}
              action={
                canWrite && !filtersActive ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                    {copy.contacts.new}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <Pagination {...pages.pagination} />

      <ContactPreview
        id={selected}
        ids={items.map((item) => item.id)}
        index={selectedIndex}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onSelect={setSelected}
      />
      <ContactCreate
        open={canWrite && (creating || createOpen)}
        onClose={() => {
          setCreateOpen(false)
          if (creating) navigate('/contactos', { replace: true })
        }}
        onCreated={(id) => {
          setCreateOpen(false)
          pages.reload()
          setSelected(id)
          if (creating) navigate('/contactos', { replace: true })
        }}
      />
    </div>
  )
}
