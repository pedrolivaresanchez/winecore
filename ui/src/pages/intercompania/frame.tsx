import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { ArrowLeft, ChevronDown, Receipt } from '@/ui/icons'
import { Button, GlassMenu, InfoTip, MenuItem, useMenuOpen } from '@/ui'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'

export type IntercompanyObject = 'liquidaciones' | 'tarifas'

const OBJECTS: { id: IntercompanyObject; label: string; path: string }[] = [
  { id: 'liquidaciones', label: copy.intercompany.settlements, path: '/intercompania' },
  { id: 'tarifas', label: copy.intercompany.tariffs, path: '/intercompania/tarifas' },
]

function ObjectSwitch({ current }: { current: IntercompanyObject }) {
  const navigate = useNavigate()
  const menu = useMenuOpen()
  const label = OBJECTS.find((item) => item.id === current)?.label ?? copy.nav.intercompany
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
          title={copy.intercompany.switch}
          className="flex h-7 min-w-0 items-center gap-1 rounded-[7px] px-1.5 text-label font-medium text-ink-900 hover:bg-fill-hover max-sm:h-11 max-sm:px-2.5"
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

export function ListFrame({
  screen,
  object,
  actions,
  mobileActions,
  toolbar,
  filters,
  banner,
  children,
}: {
  screen: string
  object: IntercompanyObject
  actions?: ReactNode
  mobileActions?: ReactNode
  toolbar?: ReactNode
  filters?: ReactNode
  banner?: ReactNode
  children: ReactNode
}) {
  const label = OBJECTS.find((item) => item.id === object)?.label ?? copy.nav.intercompany
  useChromeTitle(label)
  return (
    <div data-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <ObjectSwitch current={object} />
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
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
      {banner}
      {children}
    </div>
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
  end,
}: {
  label: string
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  end?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center border-b border-border-subtle pr-3 sm:pr-4">
      <div role="tablist" aria-label={label} className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto px-3 sm:px-4">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={value === item.id}
            className={cn(
              'h-8 shrink-0 border-b-2 px-2 text-label max-sm:h-11 max-sm:min-w-11 max-sm:px-3',
              value === item.id ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
            )}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {end ? <div className="flex shrink-0 items-center">{end}</div> : null}
    </div>
  )
}

export function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
      <dt className="flex items-center gap-1 text-caption text-text-tertiary">
        {label}
        {hint ? <InfoTip label={label}>{hint}</InfoTip> : null}
      </dt>
      <dd className="text-label break-words text-ink-900">{value}</dd>
    </div>
  )
}
