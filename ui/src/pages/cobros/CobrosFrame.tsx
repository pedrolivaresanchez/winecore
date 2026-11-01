import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useMinWidth } from '@/hooks/use-media'
import { FRAME_GUTTER } from '@/ui/frame'
import { ChevronDown, Receipt } from '@/ui/icons'
import { Button, FilterBar, GlassMenu, MenuItem, useMenuOpen, type FilterBarProps } from '@/ui'
import { copy } from '@/i18n'
import { iconStroke } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { VISTAS, type Vista } from '@/pages/cobros/vista'

type Action = { label: string; onClick: () => void; loading?: boolean }

/**
 * Cobros' four views share one header (the views as tabs, the view's buttons at the end) and
 * one filter row. On a phone the header is gone: the tabs become the bar's switch and the
 * buttons ride at the end of the bar.
 */
export function CobrosFrame({
  screen,
  vista,
  action,
  secondary,
  bar,
  children,
}: {
  screen: string
  vista: Vista
  action?: Action | null
  secondary?: Action | null
  bar: Omit<FilterBarProps, 'leading'>
  children: ReactNode
}) {
  useChromeTitle(copy.cobros.title)
  const [params, setParams] = useSearchParams()
  const phone = !useMinWidth(768)

  function openVista(next: Vista) {
    const query = new URLSearchParams()
    if (next !== 'pendiente') query.set('vista', next)
    const entity = params.get('entity')
    if (entity) query.set('entity', entity)
    setParams(query, { replace: true })
  }

  const buttons = (
    <>
      {secondary ? (
        <Button type="button" variant="secondary" size="sm" loading={secondary.loading} onClick={secondary.onClick}>
          {secondary.label}
        </Button>
      ) : null}
      {action ? (
        <Button type="button" variant="primary" size="sm" loading={action.loading} onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </>
  )

  return (
    <div data-screen={screen} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={cn('hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex', FRAME_GUTTER)}>
        <Receipt className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="shrink-0 text-label font-medium text-ink-900">{copy.cobros.title}</h1>
        <nav aria-label={copy.cobros.title} className="flex h-full min-w-0 items-end gap-1 overflow-x-auto">
          {VISTAS.map((item) => {
            const active = item.id === vista
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'h-8 shrink-0 border-b-2 px-2 text-label max-sm:h-11 max-sm:min-w-11 max-sm:px-3',
                  active ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-text-tertiary',
                )}
                aria-current={active ? 'page' : undefined}
                onClick={() => openVista(item.id)}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{buttons}</div>
      </header>

      <FilterBar
        {...bar}
        leading={<VistaSwitch vista={vista} onPick={openVista} />}
        controls={
          phone ? (
            <>
              {bar.controls}
              {bar.trailing}
            </>
          ) : (
            bar.controls
          )
        }
        trailing={
          <>
            {phone ? null : bar.trailing}
            {action || secondary ? <span className="flex items-center gap-1.5 md:hidden">{buttons}</span> : null}
          </>
        }
      />
      {children}
    </div>
  )
}

function VistaSwitch({ vista, onPick }: { vista: Vista; onPick: (next: Vista) => void }) {
  const menu = useMenuOpen()
  const current = VISTAS.find((item) => item.id === vista) ?? VISTAS[0]
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
            className="flex h-7 min-w-0 items-center gap-1 rounded-[7px] px-1.5 text-label font-medium text-ink-900 hover:bg-fill-hover max-sm:h-11 max-sm:px-2.5"
          >
            <span className="truncate">{current.label}</span>
            <ChevronDown className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
          </button>
        }
      >
        {VISTAS.map((item) => (
          <MenuItem
            key={item.id}
            active={item.id === vista}
            onClick={() => {
              menu.close()
              onPick(item.id)
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </GlassMenu>
    </div>
  )
}
