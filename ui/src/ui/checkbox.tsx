import { cn } from '../lib/cn'

export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  /** `sm` for dense rows — a grid row is 36px and the default box crowds it. */
  size?: 'sm' | 'md'
  /** Required when there is no visible label: a bare tick in a grid names nothing. */
  ariaLabel?: string
  className?: string
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  size = 'md',
  ariaLabel,
  className,
}: CheckboxProps) {
  const isChecked = checked === true
  const isIndeterminate = checked === 'indeterminate'
  const labelled = Boolean(label || description)

  /* A <label htmlFor> wrapping a <button id> is how a tick fires twice: the button
     handles the click, then the label synthesises a second one onto the same control,
     so a select immediately undoes itself. Unlabelled boxes are just the button.
     A visible label wraps without htmlFor, which is the implicit association and
     does not re-dispatch. */
  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={isIndeterminate ? 'mixed' : isChecked}
      aria-label={labelled ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!isChecked)}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xs border t-check leading-none',
        'outline-none focus-visible:shadow-(--shadow-focus)',
        size === 'sm' ? 'size-4' : 'size-4.5',
        labelled && 'mt-0.5',
        isChecked || isIndeterminate
          ? 'bg-ink-900 border-ink-900 text-ink-0'
          : 'bg-surface border-border-strong shadow-(--shadow-control) hover:border-ink-400',
      )}
    >
      {isIndeterminate ? (
        <svg
          viewBox="0 0 10 10"
          className={cn(size === 'sm' ? 'size-2.5' : 'size-3', 'fill-none stroke-current')}
          aria-hidden
        >
          <path d="M1.5 5H8.5" strokeWidth={1.6} />
        </svg>
      ) : (
        <svg
          viewBox="0 0 10.1668 10.1668"
          data-check
          className={size === 'sm' ? 'size-2.5' : 'size-3'}
          aria-hidden
        >
          <path d="M1 5.52L3.92 9.17L9.17 1" strokeWidth={1.6} />
        </svg>
      )}
    </button>
  )

  if (!labelled) {
    return (
      <span className={cn('inline-flex items-center', disabled && 'opacity-45', className)}>
        {box}
      </span>
    )
  }

  return (
    <label
      className={cn(
        'inline-flex items-start gap-2.5',
        disabled ? 'opacity-45' : 'cursor-pointer',
        className,
      )}
    >
      {box}
      <span className="flex flex-col gap-0.5">
        {label && <span className="text-body font-medium text-text leading-5">{label}</span>}
        {description && <span className="text-label text-text-tertiary">{description}</span>}
      </span>
    </label>
  )
}
