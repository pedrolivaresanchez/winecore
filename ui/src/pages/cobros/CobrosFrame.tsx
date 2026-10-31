import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { Receipt } from '@/ui/icons'
import { Button, Chip } from '@/ui'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { VISTAS, type Vista } from '@/pages/cobros/vista'

export function CobrosFrame({
  screen,
  vista,
  action,
  secondary,
  toolbar,
  filters,
  children,
}: {
  screen: string
  vista: Vista
  action?: { label: string; onClick: () => void } | null
  secondary?: { label: string; onClick: () => void } | null
  toolbar?: ReactNode
  filters?: ReactNode
  children: ReactNode
}) {
  useChromeTitle(copy.cobros.title)
  const [params, setParams] = useSearchParams()

  function openVista(next: Vista) {
    const query = new URLSearchParams(params)
    if (next === 'pendiente') query.delete('vista')
    else query.set('vista', next)
    setParams(query, { replace: true })
  }

  return (
    <div data-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.cobros.title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {secondary ? (
            <Button type="button" variant="secondary" size="sm" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          ) : null}
          {action ? (
            <Button type="button" variant="primary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
        </div>
      </header>

      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>{toolbar}</div>
        <div className="flex shrink-0 items-center gap-1.5 md:hidden">
          {secondary ? (
            <Button type="button" variant="secondary" size="sm" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          ) : null}
          {action ? (
            <Button type="button" variant="primary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>
          {VISTAS.map((item) => (
            <Chip key={item.id} pressed={vista === item.id} active={vista === item.id} onClick={() => openVista(item.id)}>
              {item.label}
            </Chip>
          ))}
          {filters}
        </div>
      </div>
      {children}
    </div>
  )
}
