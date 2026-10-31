import { Link } from 'react-router-dom'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'

export function BrandMark({
  word = 'auto',
  className,
}: {
  word?: 'always' | 'auto' | 'never'
  className?: string
}) {
  return (
    <Link to="/" className={cn('inline-flex items-center gap-2 rounded-md', className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-ink-900 text-body font-medium text-ink-0">
        W
      </span>
      <span
        className={cn(
          'text-body font-medium tracking-tight text-ink-900',
          word === 'never' && 'sr-only',
          word === 'auto' && 'max-sm:sr-only',
        )}
      >
        {copy.appName}
      </span>
    </Link>
  )
}
