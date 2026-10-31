import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'
import { isOwner } from '@/pages/aprobaciones/model'
import { ExportDialog } from '@/pages/higiene/ExportDialog'
import { hygieneTabs, tabFromPath, type HygieneTab } from '@/pages/higiene/labels'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { ArrowLeft, FlaskConical, MoreVertical } from '@/ui/icons'
import { Button, Chip, GlassMenu, MenuChip, MenuItem, useMenuOpen } from '@/ui'

export function HygieneFrame({
  me,
  screen,
  primary,
  toolbar,
  filters,
  children,
}: {
  me: Me
  screen: string
  primary?: ReactNode
  toolbar?: ReactNode
  filters?: ReactNode
  children: ReactNode
}) {
  useChromeTitle(copy.higiene.title)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const current = tabFromPath(pathname)
  const tabs = hygieneTabs(isOwner(me))
  const [exporting, setExporting] = useState(false)

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <FlaskConical className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="shrink-0 text-label font-medium text-ink-900">{copy.higiene.title}</h1>
        <nav aria-label={copy.higiene.title} className="flex h-full min-w-0 items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <TabButton key={tab.id} tab={tab.id} current={current} label={tab.label} onClick={() => navigate(tab.path)} />
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => setExporting(true)}>
            {copy.higiene.export}
          </Button>
          {primary}
        </div>
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>{toolbar}</div>
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          <Button type="button" variant="secondary" size="sm" onClick={() => setExporting(true)}>
            {copy.higiene.exportShort}
          </Button>
          {primary}
        </div>
      </div>
      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          <div className="flex items-center gap-1.5 md:hidden">
            {tabs.map((tab) => (
              <Chip key={tab.id} pressed={current === tab.id} active={current === tab.id} onClick={() => navigate(tab.path)}>
                {tab.label}
              </Chip>
            ))}
          </div>
          {filters}
        </div>
      </div>
      {children}
      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </div>
  )
}

function TabButton({
  tab,
  current,
  label,
  onClick,
}: {
  tab: HygieneTab
  current: HygieneTab
  label: string
  onClick: () => void
}) {
  const active = tab === current
  return (
    <button
      type="button"
      className={cn(
        'h-8 shrink-0 border-b-2 px-2 text-label',
        active ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
      )}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function ColumnPicker({
  columns,
  hidden,
  locked,
  onToggle,
}: {
  columns: { id: string; header: string }[]
  hidden: Set<string>
  locked: string
  onToggle: (id: string) => void
}) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-start"
      panelClassName="min-w-[200px]"
      trigger={
        <MenuChip active={menu.open} onClick={menu.toggle} title={copy.higiene.columns}>
          {copy.higiene.columns}
        </MenuChip>
      }
    >
      {columns.map((column) => (
        <MenuItem key={column.id} checked={!hidden.has(column.id)} disabled={column.id === locked} onClick={() => onToggle(column.id)}>
          {column.header}
        </MenuItem>
      ))}
    </GlassMenu>
  )
}

export function MoreMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const menu = useMenuOpen()
  return (
    <GlassMenu
      open={menu.open}
      onOpenChange={menu.setOpen}
      placement="bottom-end"
      trigger={
        <Button type="button" variant="secondary" size="sm" iconOnly aria-label={label} onClick={menu.toggle}>
          <MoreVertical strokeWidth={iconStroke} />
        </Button>
      }
    >
      {children(menu.close)}
    </GlassMenu>
  )
}

export function RecordPage({
  screen,
  backTo,
  backLabel,
  actions,
  footer,
  children,
}: {
  screen: string
  backTo: string
  backLabel: string
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 sm:px-4">
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label={backLabel} onClick={() => navigate(backTo)}>
          <ArrowLeft strokeWidth={iconStroke} />
        </Button>
        <span className="min-w-0 truncate text-label text-text-tertiary">{backLabel}</span>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-8">{children}</div>
      </div>
      {footer ? (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </footer>
      ) : null}
    </div>
  )
}
