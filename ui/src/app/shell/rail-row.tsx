import type { ReactNode } from 'react'
import { Tooltip } from '@/ui'
import { tagToneClass, type TagTone } from '@/ui/tag-palette'
import { cn } from '@/lib/cn'

/**
 * The lit row takes its section's tint and ink, with a dot-coloured bar on the leading
 * edge, so where you are reads from the colour before the label is read.
 */
function rowFace(active: boolean, tone: TagTone | undefined) {
  if (!tone) return active ? 'bg-sidebar-selected font-medium text-ink-900' : 'text-control hover:bg-sidebar-hover'
  return cn(
    tagToneClass(tone),
    active
      ? 'bg-(--tag-bg-0)/60 font-medium text-(--tag-fg-0) before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-(--tag-dot-0)'
      : 'text-control hover:bg-sidebar-hover',
  )
}

/** A 28px rail destination. Collapsed, the label is the tooltip. */
export function RailRow({
  active,
  label,
  glyph,
  trailing,
  tone,
  collapsed = false,
  onNavigate,
}: {
  active: boolean
  label: string
  glyph: ReactNode
  trailing?: ReactNode
  tone?: TagTone
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
            'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-label',
            'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out)',
            rowFace(active, tone),
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
        'relative flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-label',
        'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out)',
        rowFace(active, tone),
      )}
    >
      {glyph}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}
