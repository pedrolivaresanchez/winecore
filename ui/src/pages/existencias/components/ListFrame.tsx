import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { FRAME_GUTTER } from '@/ui/frame'
import { ChevronDown } from '@/ui/icons'
import { GlassMenu, MenuItem, useMenuOpen } from '@/ui'

const SECTIONS = [
  { id: 'stock', label: copy.stock.title, path: '/stock' },
  { id: 'moves', label: copy.stock.moves, path: '/stock/movimientos' },
  { id: 'counts', label: copy.stock.counts, path: '/stock/aforos' },
] as const

export type StockSection = (typeof SECTIONS)[number]['id']

export function ListFrame({
  screen,
  title,
  section,
  icon,
  actions,
  toolbar,
  filters,
  bar,
  children,
}: {
  screen: string
  title: string
  section: StockSection
  icon: ReactNode
  actions?: ReactNode
  toolbar?: ReactNode
  filters?: ReactNode
  /** A `FilterBar` in place of the toolbar and filter rows. */
  bar?: ReactNode
  children: ReactNode
}) {
  useChromeTitle(title)
  const navigate = useNavigate()
  const menu = useMenuOpen()

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <span className="flex size-4 shrink-0 items-center text-icon">{icon}</span>
        <GlassMenu
          open={menu.open}
          onOpenChange={menu.setOpen}
          placement="bottom-start"
          panelClassName="min-w-[180px]"
          trigger={
            <button type="button" className="flex min-w-0 items-center gap-1" onClick={menu.toggle}>
              <h1 className="truncate text-label font-medium text-ink-900">{title}</h1>
              <ChevronDown className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
            </button>
          }
        >
          {SECTIONS.map((item) => (
            <MenuItem
              key={item.id}
              checked={item.id === section}
              onClick={() => {
                menu.close()
                navigate(item.path)
              }}
            >
              {item.label}
            </MenuItem>
          ))}
        </GlassMenu>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : <span className="ml-auto" />}
      </header>
      {bar ?? (
        <>
          <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
            {toolbar}
          </div>
          {filters ? (
            <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
              {filters}
            </div>
          ) : null}
        </>
      )}
      {children}
    </div>
  )
}
