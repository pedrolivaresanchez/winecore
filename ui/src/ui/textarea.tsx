import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'
import { textureSecondary } from './button'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

/**
 * Multi-line control — shares secondary-button chrome (gradient face,
 * inset rim, whisper drop) with Input pills and secondary CTAs.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ invalid, className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        /* 16px on mobile — iOS zooms focused inputs under 16px. */
        'block w-full resize-none rounded-md px-3 py-2 text-base text-text sm:text-body',
        'outline-none transition-[background-image,border-color,box-shadow] duration-150 ease-out',
        'placeholder:text-text-tertiary',
        textureSecondary,
        invalid
          ? 'border-danger-500 focus-visible:shadow-[0_1px_1px_rgb(24_24_27_/_0.04),0_1px_2px_rgb(24_24_27_/_0.06),0_0_0_3px_rgb(229_72_77_/_0.12)]'
          : 'focus-visible:border-border-strong focus-visible:shadow-(--shadow-focus)',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
