import type { ReactNode } from 'react'
import { Tooltip } from '@/ui'
import { cn } from '@/lib/cn'

/** A 28px rail destination. Collapsed, the label is the tooltip. */
export function RailRow({
  active,
  label,
  glyph,
  trailing,
  collapsed = false,
  onNavigate,
}: {
  active: boolean
  label: string
  glyph: ReactNode
  trailing?: ReactNode
  collapsed?: boolean
  onNavigate: () => void
}) {
  const face = active ? 'bg-sidebar-selected font-medium text-ink-900' : 'text-control hover:bg-sidebar-hover'
  if (collapsed) {
    return (
      <Tooltip label={label} placement="right">
        <button
          type="button"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={onNavigate}
          className={cn(
            'group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-label',
            'transition-[color,background-color,transform] duration-(--duration-quick) ease-(--ease-smooth-out)',
            face,
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
        'group relative flex h-7 w-full items-center gap-2 rounded-md py-0 pr-2 pl-2 text-left text-label max-md:h-11',
        'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out)',
        face,
      )}
    >
      {glyph}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}
