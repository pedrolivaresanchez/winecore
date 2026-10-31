import { type ReactNode } from 'react'
import { cn } from '../lib/cn'

export type IconWellSize = 'sm' | 'md' | 'lg'

const sizes: Record<IconWellSize, string> = {
  sm: 'size-10 [&_svg]:size-4',
  md: 'size-14 [&_svg]:size-5',
  lg: 'size-20 [&_svg]:size-7',
}

/**
 * Soft elevated circular well — the Counsel empty-state icon treatment.
 * Hairline border + float shadow, icon in control ink.
 */
export function IconWell({
  children,
  size = 'lg',
  className,
}: {
  children: ReactNode
  size?: IconWellSize
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full',
        'bg-surface-subtle border border-border-subtle shadow-(--shadow-float)',
        'text-control [&_svg]:stroke-[1.5]',
        sizes[size],
        className,
      )}
    >
      {children}
    </div>
  )
}
