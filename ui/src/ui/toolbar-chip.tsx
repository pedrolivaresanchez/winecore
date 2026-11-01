import type { ReactNode } from 'react'
import { ChevronDown, X, type IconComponent } from './icons'
import { textureSecondaryFace, textureSecondaryHover } from './button'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'

/**
 * Toolbar control: 28px, 7px corners, the secondary button face.
 * `dashed` is an empty slot (a filter with nothing in it). `selected` is a quick filter that
 * is on: the info wash and contour a ticked row and a sorted header already wear.
 */
export function Chip({
  icon: Icon,
  label,
  children,
  onClick,
  onClear,
  active,
  pressed,
  selected,
  variant = 'face',
  trailing,
  title,
  className,
  ...data
}: {
  icon?: IconComponent
  label?: string
  children?: ReactNode
  onClick?: () => void
  onClear?: () => void
  active?: boolean
  pressed?: boolean
  selected?: boolean
  variant?: 'face' | 'dashed'
  trailing?: ReactNode
  title?: string
  className?: string
  [data: `data-${string}`]: string | undefined
}) {
  const dashed = variant === 'dashed' && !active && !selected
  const glyphOnly = Boolean(Icon) && !children && !label

  return (
    <span
      {...data}
      className={cn(
        'inline-flex h-7 shrink-0 items-center rounded-[7px] text-label',
        'transition-[background-image,background-color,border-color,box-shadow,color] duration-(--duration-quick) ease-(--ease-smooth-out)',
        selected
          ? 'border border-info-500/60 bg-info-50 font-medium text-info-700'
          : dashed
            ? 'border border-dashed border-border'
            : textureSecondaryFace,
        onClick &&
          (selected
            ? 'hover:border-info-500'
            : dashed
              ? 'hover:border-solid hover:border-border-strong'
              : textureSecondaryHover),
        selected ? null : active ? 'border-border-strong font-medium text-ink-900' : dashed ? 'text-text-tertiary' : 'text-control',
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={pressed}
        disabled={!onClick}
        className={cn(
          'flex h-full min-w-0 items-center gap-1.5 rounded-[6px] outline-none',
          'focus-visible:shadow-(--shadow-focus)',
          glyphOnly ? 'px-1.5' : cn(Icon ? 'pl-1' : 'pl-2', onClear ? 'pr-1' : 'pr-2'),
          onClick && !selected && 'hover:text-ink-900',
        )}
      >
        {Icon ? <Icon className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} /> : null}
        {label ? <span className="shrink-0 font-normal text-text-tertiary">{label}</span> : null}
        {children ? <span className="min-w-0 truncate">{children}</span> : null}
        {trailing}
      </button>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={title}
          className={cn(
            'mr-1 flex size-5 shrink-0 items-center justify-center rounded-[4px] text-icon-muted outline-none',
            'hover:bg-fill-muted hover:text-ink-900 focus-visible:shadow-(--shadow-focus)',
          )}
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      ) : null}
    </span>
  )
}

export function MenuChip({
  icon,
  label,
  children,
  onClick,
  active,
  variant,
  title,
}: {
  icon?: IconComponent
  label?: string
  children: ReactNode
  onClick: () => void
  active?: boolean
  variant?: 'face' | 'dashed'
  title?: string
}) {
  return (
    <Chip
      icon={icon}
      label={label}
      onClick={onClick}
      active={active}
      variant={variant}
      title={title}
      trailing={<ChevronDown className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />}
    >
      {children}
    </Chip>
  )
}

export function ChipDivider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
}
