import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { ArrowLeft, Box, ChevronDown } from '@/ui/icons'
import { Button, GlassMenu, MenuItem, useMenuOpen } from '@/ui'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'

export type CatalogObject = 'productos' | 'vinos' | 'formatos' | 'tarifas'

const OBJECTS: { id: CatalogObject; label: string; path: string }[] = [
  { id: 'productos', label: copy.catalog.products, path: '/catalogo' },
  { id: 'vinos', label: copy.catalog.wines, path: '/catalogo/vinos' },
  { id: 'formatos', label: copy.catalog.formats, path: '/catalogo/formatos' },
  { id: 'tarifas', label: copy.catalog.tariffs, path: '/catalogo/tarifas' },
]

function ObjectSwitch({ current }: { current: CatalogObject }) {
  const navigate = useNavigate()
  const menu = useMenuOpen()
  const label = OBJECTS.find((item) => item.id === current)?.label ?? copy.catalog.title
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-start"
      panelClassName="min-w-[200px]"
      trigger={
        <button
          type="button"
          onClick={menu.toggle}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          title={copy.catalog.switch}
          className="flex h-7 min-w-0 items-center gap-1 rounded-[7px] px-1.5 text-label font-medium text-ink-900 hover:bg-fill-hover"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
        </button>
      }
    >
      {OBJECTS.map((item) => (
        <MenuItem
          key={item.id}
          active={item.id === current}
          onClick={() => {
            menu.close()
            navigate(item.path)
          }}
        >
          {item.label}
        </MenuItem>
      ))}
    </GlassMenu>
  )
}

/** The object switcher for a phone, where the header that holds it is hidden. Goes in a `FilterBar`'s `leading`. */
export function MobileObjectSwitch({ current }: { current: CatalogObject }) {
  return (
    <div className="shrink-0 md:hidden">
      <ObjectSwitch current={current} />
    </div>
  )
}

export function ListFrame({
  screen,
  object,
  actions,
  mobileActions,
  toolbar,
  filters,
  bar,
  children,
}: {
  screen: string
  object: CatalogObject
  actions?: ReactNode
  mobileActions?: ReactNode
  toolbar?: ReactNode
  filters?: ReactNode
  /** A `FilterBar` in place of the toolbar and filter rows; it carries `MobileObjectSwitch` itself. */
  bar?: ReactNode
  children: ReactNode
}) {
  const label = OBJECTS.find((item) => item.id === object)?.label ?? copy.catalog.title
  useChromeTitle(label)
  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Box className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <ObjectSwitch current={object} />
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      {bar ?? <ToolbarRows object={object} toolbar={toolbar} filters={filters} mobileActions={mobileActions} />}
      {children}
    </div>
  )
}

function ToolbarRows({
  object,
  toolbar,
  filters,
  mobileActions,
}: {
  object: CatalogObject
  toolbar?: ReactNode
  filters?: ReactNode
  mobileActions?: ReactNode
}) {
  return (
    <>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className="shrink-0 md:hidden">
          <ObjectSwitch current={object} />
        </div>
        <div className={FRAME_STRIP_SCROLL}>{toolbar}</div>
        {mobileActions ? <div className="flex shrink-0 items-center gap-1.5 md:hidden">{mobileActions}</div> : null}
      </div>
      {filters ? (
        <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
          <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>{filters}</div>
        </div>
      ) : null}
    </>
  )
}

export function RecordBar({ backTo, backLabel, actions }: { backTo: string; backLabel: string; actions?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
      <Button type="button" variant="ghost" size="sm" iconOnly aria-label={backLabel} onClick={() => navigate(backTo)}>
        <ArrowLeft strokeWidth={iconStroke} />
      </Button>
      <span className="min-w-0 truncate text-label text-text-tertiary">{backLabel}</span>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  )
}

export function RecordTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" aria-label={label} className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-border-subtle px-4">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={cn(
            'h-8 shrink-0 border-b-2 px-2 text-label',
            value === item.id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
          )}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function FactCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{title}</h2>
      {children}
    </section>
  )
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="text-caption text-text-tertiary">{label}</dt>
      <dd className="text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}
