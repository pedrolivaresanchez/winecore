import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { textureSecondary } from './button'

export type InputSize = 'sm' | 'md' | 'lg'
export type InputShape = 'field' | 'pill'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: InputSize
  /**
   * `field` — paired radii (7 / 8 / 10px), secondary-button chrome.
   * `pill` — fully rounded, same secondary-button chrome (search bars).
   */
  shape?: InputShape
  prefix?: ReactNode
  suffix?: ReactNode
  invalid?: boolean
}

const fieldSizes: Record<InputSize, { root: string; gap: string }> = {
  sm: { root: 'h-7 rounded-[7px] px-2.5 text-label [&_svg]:size-3.5', gap: 'gap-1.5' },
  md: { root: 'h-8 rounded-md px-2.5 text-body [&_svg]:size-3.5', gap: 'gap-2' },
  lg: { root: 'h-9 rounded-lg px-3 text-body [&_svg]:size-4', gap: 'gap-2' },
}

/** Padding and height match Button sizes; always `rounded-full`. */
const pillSizes: Record<InputSize, { root: string; gap: string }> = {
  sm: { root: 'h-7 rounded-full px-3 text-label [&_svg]:size-3.5', gap: 'gap-1.5' },
  md: { root: 'h-8 rounded-full px-3.5 text-body [&_svg]:size-3.5', gap: 'gap-2' },
  lg: { root: 'h-9 rounded-full px-4 text-body [&_svg]:size-4', gap: 'gap-2' },
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'md', shape = 'field', prefix, suffix, invalid, className, disabled, ...props }, ref) => {
    const sizes = shape === 'pill' ? pillSizes : fieldSizes
    const boxRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      const el = boxRef.current
      if (!el) return
      if (!invalid) {
        el.classList.remove('is-error', 'is-shaking')
        return
      }
      el.classList.add('is-error')
      el.classList.remove('is-shaking')
      void el.offsetWidth
      el.classList.add('is-shaking')
    }, [invalid])

    return (
      <div
        ref={boxRef}
        className={cn(
          't-input inline-flex w-full items-center',
          'transition-[background-image,border-color,box-shadow] duration-150 ease-out',
          sizes[size].root,
          sizes[size].gap,
          textureSecondary,
          invalid
            ? 'border-danger-500 has-focus-visible:shadow-[0_1px_1px_rgb(24_24_27_/_0.04),0_1px_2px_rgb(24_24_27_/_0.06),0_0_0_3px_rgb(229_72_77_/_0.12)]'
            : 'has-focus-visible:border-border-strong has-focus-visible:shadow-(--shadow-focus)',
          disabled && 'pointer-events-none opacity-45',
          className,
        )}
      >
        {prefix && (
          <span className="flex shrink-0 items-center text-control [&_svg]:stroke-[1.5]">{prefix}</span>
        )}
        <input
          ref={ref}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className="w-full bg-transparent text-control outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed"
          {...props}
        />
        {suffix && <span className="flex shrink-0 items-center text-control">{suffix}</span>}
      </div>
    )
  },
)
Input.displayName = 'Input'
