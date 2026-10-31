import type { ReactNode } from 'react'
import { Tooltip } from '@/ui'
import { cn } from '@/lib/cn'

/** A 28px rail destination. Collapsed, the label is the tooltip. */
export function RailRow({
  active,
  label,
  glyph,
  collapsed = false,
  onNavigate,
}: {
  active: boolean
  label: string
  glyph: ReactNode
  collapsed?: boolean
  onNavigate: () => void
}) {
  if (collapsed) {
    return (
      <Tooltip label={label} placement="right">
        <button
          type="button"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-label',
            'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out)',
            active ? 'bg-sidebar-selected font-medium text-ink-900' : 'text-control hover:bg-sidebar-hover',
          )}
        >
          {glyph}
        </button>
      </Tooltip>
    )
  }

  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      title={label}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-label',
        'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out)',
        active ? 'bg-sidebar-selected font-medium text-ink-900' : 'text-control hover:bg-sidebar-hover',
      )}
    >
      {glyph}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
