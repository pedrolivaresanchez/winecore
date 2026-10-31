import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from '@/ui/frame'
import { FlaskConical, MoreVertical } from '@/ui/icons'
import { Button, GlassMenu, SegmentedControl, useMenuOpen } from '@/ui'
import { sectionPath, type CatasSection } from '@/pages/catas/paths'

export function CatasFrame({
  screen,
  section,
  title,
  action,
  toolbar,
  filters,
  children,
}: {
  screen: string
  section: CatasSection
  title: string
  action?: ReactNode
  toolbar?: ReactNode
  filters?: ReactNode
  children: ReactNode
}) {
  useChromeTitle(title)
  const navigate = useNavigate()
  const [params] = useSearchParams()

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <FlaskConical className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{title}</h1>
        {action ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{action}</div> : <span className="ml-auto" />}
      </header>
      <div className={cn('flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle', FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <SegmentedControl
            size="sm"
            aria-label={copy.catas.title}
            value={section}
            onChange={(next) => navigate(sectionPath(next, params))}
            options={[
              { value: 'notas', content: copy.catas.notes },
              { value: 'ciegas', content: copy.catas.blindShort },
              { value: 'evolucion', content: copy.catas.evolution },
            ]}
          />
          {toolbar}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1.5 md:hidden">{action}</div> : null}
      </div>
      {filters ? (
        <div className={cn('flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle', FRAME_GUTTER)}>
          <div className={cn(FRAME_STRIP_SCROLL, '[&>*]:shrink-0')}>{filters}</div>
        </div>
      ) : null}
      {children}
    </div>
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

export function FactCard({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return null
  return (
    <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
      <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{title}</h2>
      <dl>
        {rows.map((row) => (
          <div key={row.label} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
            <dt className="text-caption text-text-tertiary">{row.label}</dt>
            <dd className="text-label break-words text-ink-900">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function RecordColumn({ screen, children }: { screen: string; children: ReactNode }) {
  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}
