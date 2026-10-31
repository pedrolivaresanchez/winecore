import { useState } from 'react'
import { cn } from '../lib/cn'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  className?: string
}

/**
 * On/off switch. Thumb travel is the transitions.dev toggle: a double-bounce
 * overshoot on the 350ms clock. `.is-init` is added on the first click so the
 * off keyframes do not play on mount.
 */
export function Switch({ checked, onChange, disabled, id, className, ...props }: SwitchProps) {
  const [init, setInit] = useState(false)

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      data-on={checked ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => {
        setInit(true)
        onChange(!checked)
      }}
      className={cn(
        't-toggle relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border px-0.5',
        'outline-none focus-visible:shadow-(--shadow-focus)',
        init && 'is-init',
        checked ? 'bg-ink-900 border-ink-900' : 'bg-ink-150 border-ink-200',
        disabled && 'opacity-45 pointer-events-none',
        className,
      )}
      {...props}
    >
      <span className="t-toggle-thumb pointer-events-none block size-4.5 rounded-full bg-surface shadow-(--shadow-raised)" />
    </button>
  )
}
