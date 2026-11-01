import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Briefcase,
  Building,
  FileText,
  Keyboard,
  Moon,
  PanelLeft,
  Plus,
  Receipt,
  Search,
  Settings2,
  Sun,
  User,
  Users,
  type IconComponent,
} from '@/ui/icons'
import { Dialog, Kbd } from '@/ui'
import { ObjectGlyph, type GlyphTint } from '@/ui/object-glyph'
import { visibleGroups } from '@/app/nav'
import { useTheme } from '@/theme/theme-provider'
import { listContacts, type ContactSummary } from '@/lib/contacts'
import { isAbortError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'

type Group = 'records' | 'goTo' | 'create' | 'actions'

type Command = {
  id: string
  group: Group
  label: string
  hint?: string
  icon: IconComponent
  /** The object's glyph tint, so a place looks the same here as in the rail. */
  tint?: GlyphTint
  keywords?: string
  /** Offered once you type; an empty palette shows the rail's first rows only. */
  secondary?: boolean
  run: () => void
}

const GROUP_ORDER: Group[] = ['records', 'goTo', 'create', 'actions']
const RECORD_LIMIT = 6
const SEARCH_DELAY_MS = 140

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Every word of the query somewhere in the label or its keywords, in any order. */
function matches(command: Command, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = fold(`${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`)
  return terms.every((term) => haystack.includes(term))
}

function useContactHits(q: string, enabled: boolean) {
  const [hits, setHits] = useState<ContactSummary[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const term = q.trim()
    if (!enabled || term.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      listContacts({ q: term, limit: RECORD_LIMIT }, controller.signal)
        .then((page) => setHits(page.items.slice(0, RECORD_LIMIT)))
        .catch((error: unknown) => {
          if (!isAbortError(error)) setHits([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, SEARCH_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [q, enabled])
  return { hits, loading }
}

/**
 * Cmd-K: records first, then places, then things to make, then switches. One list under one
 * caret — arrows move, Enter opens — so the keyboard never has to leave the field.
 */
export function CommandPalette({
  me,
  open,
  onClose,
  onToggleRail,
  onSettings,
  onShortcuts,
}: {
  me: Me
  open: boolean
  onClose: () => void
  onToggleRail: () => void
  onSettings: () => void
  onShortcuts: () => void
}) {
  const navigate = useNavigate()
  const { resolved, setTheme } = useTheme()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const canContacts = allows(me, 'contacts.read')
  const { hits, loading } = useContactHits(q, open && canContacts)

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const base = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path)
    const places: Command[] = visibleGroups(me).flatMap((group) =>
      group.items.map((item) => ({
        id: `go-${item.id}`,
        group: 'goTo' as const,
        label: item.label,
        hint: group.label,
        icon: item.icon,
        tint: item.tint,
        keywords: item.keywords,
        secondary: item.tier !== 'primary',
        run: go(item.path),
      })),
    )
    const creates: (Command & { permission: string })[] = [
      { id: 'new-contact', group: 'create', label: copy.command.newContact, icon: Users, permission: 'contacts.write', keywords: 'cliente proveedor', run: go('/contactos/nuevo') },
      { id: 'new-invoice', group: 'create', label: copy.command.newInvoice, icon: FileText, permission: 'billing.write', run: go('/facturas/nueva') },
      { id: 'new-quote', group: 'create', label: copy.command.newQuote, icon: Receipt, permission: 'sales.write', keywords: 'venta oferta', run: go('/ventas/presupuestos/nuevo') },
      { id: 'new-order', group: 'create', label: copy.command.newOrder, icon: Receipt, permission: 'sales.write', keywords: 'venta', run: go('/ventas/pedidos/nuevo') },
      { id: 'new-operation', group: 'create', label: copy.command.newOperation, icon: Plus, permission: 'cellar.operate', keywords: 'trasiego deposito lote', run: go('/bodega/operaciones/nueva') },
      { id: 'new-expense', group: 'create', label: copy.command.newExpense, icon: Briefcase, permission: 'purchasing.write', keywords: 'gasto ticket factura proveedor', run: go('/gastos/capturar') },
      { id: 'new-product', group: 'create', label: copy.command.newProduct, icon: Box, permission: 'catalog.write', keywords: 'catalogo articulo', run: go('/catalogo/nuevo') },
    ]
    const dark = resolved === 'dark'
    const actions: Command[] = [
      { id: 'theme', group: 'actions', label: dark ? copy.command.themeLight : copy.command.themeDark, icon: dark ? Sun : Moon, keywords: 'tema oscuro claro modo', run: () => setTheme(dark ? 'light' : 'dark') },
      { id: 'rail', group: 'actions', label: copy.command.toggleRail, icon: PanelLeft, keywords: 'barra lateral sidebar', run: onToggleRail },
      { id: 'settings', group: 'actions', label: copy.nav.settings, icon: Settings2, keywords: 'ajustes configuracion empresa', run: onSettings },
      { id: 'shortcuts', group: 'actions', label: copy.command.shortcuts, icon: Keyboard, keywords: 'teclado atajos ayuda', run: onShortcuts },
    ]
    return [...places, ...creates.filter((command) => allows(me, command.permission)), ...actions]
  }, [me, navigate, resolved, setTheme, onToggleRail, onSettings, onShortcuts])

  const terms = fold(q.trim()).split(/\s+/).filter(Boolean)
  const records: Command[] = hits.map((contact) => ({
    id: `contact-${contact.id}`,
    group: 'records',
    label: contact.legal_name,
    hint: contact.tax_id ?? undefined,
    icon: contact.kind === 'person' ? User : Building,
    run: () => navigate(`/contactos/${contact.id}`),
  }))
  const offered = terms.length === 0 ? base.filter((command) => !command.secondary) : base.filter((command) => matches(command, terms))
  const shown = [...records, ...offered]
  const ordered = GROUP_ORDER.flatMap((group) => shown.filter((command) => command.group === group))
  const current = Math.min(active, Math.max(ordered.length - 1, 0))

  useLayoutEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [current, ordered.length])

  function run(command: Command | undefined) {
    if (!command) return
    onClose()
    command.run()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault()
      setActive((current + 1) % Math.max(ordered.length, 1))
    } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault()
      setActive((current - 1 + ordered.length) % Math.max(ordered.length, 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(ordered[current])
    }
  }

  let index = -1

  return (
    <Dialog open={open} onClose={onClose} align="top" size="md" labelledBy="command-title">
      <h2 id="command-title" className="sr-only">
        {copy.command.title}
      </h2>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border-subtle px-4">
        <Search className="size-4 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
        <input
          ref={inputRef}
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={copy.command.placeholder}
          aria-label={copy.command.title}
          aria-controls="command-list"
          aria-activedescendant={ordered[current] ? `command-${ordered[current].id}` : undefined}
          role="combobox"
          aria-expanded
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-body text-ink-900 outline-none placeholder:text-text-tertiary"
        />
        {loading ? <span className="shrink-0 text-caption text-text-tertiary">{copy.command.searching}</span> : null}
      </div>

      <div ref={listRef} id="command-list" role="listbox" className="max-h-[min(60dvh,420px)] overflow-y-auto overscroll-contain p-1.5">
        {ordered.length === 0 ? (
          <p className="px-3 py-8 text-center text-label text-text-tertiary">
            {loading ? copy.command.searching : fill(copy.command.empty, { q: q.trim() })}
          </p>
        ) : (
          GROUP_ORDER.map((group) => {
            const rows = ordered.filter((command) => command.group === group)
            if (rows.length === 0) return null
            return (
              <div key={group} role="group" aria-label={copy.command[group]} className="pb-1">
                <p className="px-2.5 pt-2 pb-1 text-caption font-medium text-text-tertiary">{copy.command[group]}</p>
                {rows.map((command) => {
                  index += 1
                  const position = index
                  const selected = position === current
                  const Icon = command.icon
                  return (
                    <button
                      key={command.id}
                      id={`command-${command.id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-active={selected ? '' : undefined}
                      tabIndex={-1}
                      onMouseMove={() => {
                        if (!selected) setActive(position)
                      }}
                      onClick={() => run(command)}
                      className={cn(
                        'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-label outline-none',
                        selected ? 'bg-fill-hover text-ink-900' : 'text-control',
                      )}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center">
                        {command.tint ? (
                          <ObjectGlyph icon={Icon} tint={command.tint} size="md" />
                        ) : (
                          <Icon className={cn('size-4 shrink-0', selected ? 'text-ink-900' : 'text-icon-muted')} strokeWidth={iconStroke} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.hint ? <span className="max-w-[40%] shrink-0 truncate text-caption text-text-tertiary">{command.hint}</span> : null}
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      <div className="hidden shrink-0 items-center gap-4 border-t border-border-subtle px-4 py-2 text-caption text-text-tertiary sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {copy.command.hintMove}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {copy.command.hintOpen}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {copy.command.hintClose}
        </span>
      </div>
    </Dialog>
  )
}
