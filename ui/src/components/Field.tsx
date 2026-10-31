import type { ReactNode } from 'react'

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-label text-text-secondary">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-caption text-danger-600">
          {error}
        </p>
      ) : null}
      {hint && !error ? <p className="text-caption text-text-tertiary">{hint}</p> : null}
    </div>
  )
}
