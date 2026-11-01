import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { docPath, docTitle, type DocKind } from '@/lib/sales'
import { FRAME_GUTTER } from '@/ui/frame'
import { ChevronDown, Receipt } from '@/ui/icons'
import { GlassMenu, MenuItem, useMenuOpen } from '@/ui'

const DOCS: readonly DocKind[] = ['quote', 'order', 'delivery']

/** Ventas header from `md` up: the three books as tabs, the page's own buttons at the end. */
export function SalesHeader({ current, actions }: { current: DocKind; actions?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
      <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
      <h1 className="shrink-0 text-label font-medium text-ink-900">{copy.sales.title}</h1>
      <nav aria-label={copy.sales.title} className="flex h-full min-w-0 items-end gap-1 overflow-x-auto">
        {DOCS.map((doc) => {
          const active = doc === current
          return (
            <button
              key={doc}
              type="button"
              className={cn(
                'h-8 shrink-0 border-b-2 px-2 text-label',
                active ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
              )}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(docPath(doc))}
            >
              {docTitle(doc)}
            </button>
          )
        })}
      </nav>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  )
}

/** The same switch for a `FilterBar`'s leading slot: on a phone the header that holds the tabs is gone. */
export function SalesSwitch({ current }: { current: DocKind }) {
  const navigate = useNavigate()
  const menu = useMenuOpen()
  return (
    <div className="shrink-0 md:hidden">
      <GlassMenu
        open={menu.open}
        onOpenChange={menu.setOpen}
        placement="bottom-start"
        panelClassName="min-w-[180px]"
        trigger={
          <button
            type="button"
            onClick={menu.toggle}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            className="flex h-7 min-w-0 items-center gap-1 rounded-[7px] px-1.5 text-label font-medium text-ink-900 hover:bg-fill-hover"
          >
            <span className="truncate">{docTitle(current)}</span>
            <ChevronDown className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
          </button>
        }
      >
        {DOCS.map((doc) => (
          <MenuItem
            key={doc}
            active={doc === current}
            onClick={() => {
              menu.close()
              navigate(docPath(doc))
            }}
          >
            {docTitle(doc)}
          </MenuItem>
        ))}
      </GlassMenu>
    </div>
  )
}
