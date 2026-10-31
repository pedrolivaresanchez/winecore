import { type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/** Inline mark for redlined / accepted clauses — Counsel green highlight. */
export function Mark({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <mark
      className={cn('rounded-sm bg-mark text-mark-fg px-0.5 py-px', className)}
      {...props}
    />
  )
}

/** Soft content surface used for document panes and review cards. */
export function Surface({
  children,
  className,
  elevated = false,
}: {
  children: ReactNode
  className?: string
  elevated?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface',
        elevated ? 'shadow-(--shadow-raised)' : 'shadow-(--shadow-control)',
        className,
      )}
    >
      {children}
    </div>
  )
}
