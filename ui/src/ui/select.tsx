import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronsUpDown } from './icons'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'
import { textureSecondary } from './button'

export type SelectSize = 'sm' | 'md' | 'lg'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: SelectSize
}

/**
 * Compact control — same secondary-button chrome as Input / secondary CTAs.
 * 32px default, control label, thin ChevronsUpDown.
 */
const sizes: Record<SelectSize, { root: string; select: string; chevron: string }> = {
  sm: { root: 'h-7 rounded-[7px]', select: 'pl-2.5 pr-6 text-label', chevron: 'right-1.5 size-3.5' },
  md: { root: 'h-8 rounded-md', select: 'pl-2.5 pr-7 text-body', chevron: 'right-2 size-3.5' },
  lg: { root: 'h-9 rounded-lg', select: 'pl-3 pr-8 text-body', chevron: 'right-2.5 size-4' },
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = 'md', className, children, disabled, ...props }, ref) => (
    <div
      className={cn(
        'relative inline-flex items-center',
        textureSecondary,
        'transition-[background-image,border-color,box-shadow] duration-150 ease-out',
        'has-focus-visible:shadow-(--shadow-focus) has-focus-visible:border-border-strong',
        disabled && 'pointer-events-none opacity-45',
        sizes[size].root,
        className,
      )}
    >
      <select
        ref={ref}
        disabled={disabled}
        className={cn(
          'h-full w-full appearance-none bg-transparent outline-none cursor-pointer leading-none',
          'font-medium text-control disabled:cursor-not-allowed',
          sizes[size].select,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronsUpDown
        strokeWidth={iconStroke}
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-control',
          sizes[size].chevron,
        )}
      />
    </div>
  ),
)
Select.displayName = 'Select'
