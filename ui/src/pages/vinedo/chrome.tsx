import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { MapPin } from '@/ui/icons'
import { Button, Chip } from '@/ui'
import { SECTIONS, sectionLabel, type Section } from '@/pages/vinedo/labels'

export function VineyardShell({
  section,
  screen,
  actions,
  children,
}: {
  section: Section
  screen: string
  actions?: ReactNode
  children: ReactNode
}) {
  const [params, setParams] = useSearchParams()
  const strip = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = strip.current
    const active = root?.querySelector<HTMLElement>('[data-active="true"]')
    if (!root || !active) return
    const left = active.offsetLeft - 8
    const right = left + active.offsetWidth
    if (left < root.scrollLeft || right > root.scrollLeft + root.clientWidth - 8) {
      root.scrollLeft = Math.max(0, left)
    }
  }, [section])

  function go(next: Section) {
    const query = new URLSearchParams(params)
    if (next === 'parcelas') query.delete('seccion')
    else query.set('seccion', next)
    query.delete('ticket')
    query.delete('alta')
    query.delete('parcela')
    setParams(query, { replace: true })
  }

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <MapPin className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.nav.vineyard}</h1>
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div ref={strip} className={FRAME_STRIP_SCROLL} role="tablist" aria-label={copy.nav.vineyard}>
          {SECTIONS.map((id) => (
            <span key={id} data-active={section === id ? 'true' : undefined} className="shrink-0">
              <Chip pressed={section === id} active={section === id} onClick={() => go(id)}>
                {sectionLabel(id)}
              </Chip>
            </span>
          ))}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5 md:hidden">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function ScoreScale({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-label text-text-secondary">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {['1', '2', '3', '4', '5'].map((score) => (
          <Button
            key={score}
            type="button"
            size="sm"
            className="max-sm:min-w-11"
            variant={value === score ? 'primary' : 'secondary'}
            role="radio"
            aria-checked={value === score}
            onClick={() => onChange(value === score ? '' : score)}
          >
            {score}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function FormStack({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-4">{children}</div>
}

export function BlockTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-caption text-text-tertiary">{children}</h2>
}
