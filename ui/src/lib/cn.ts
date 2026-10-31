import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** Teach the merger our four-step type scale so `text-body` (size) never
    collides with `text-ink-900` (color). */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['caption', 'label', 'body', 'heading'] }],
    },
  },
})

/**
 * Class combinator with Tailwind conflict resolution — later classes win
 * (`cn('relative', 'absolute')` → `absolute`), so callers can override
 * primitive defaults without `!important`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
