import { ChevronLeft, ChevronRight } from './icons'
import { FRAME_GUTTER } from './frame'
import { Select } from './select'
import { fillLabel, useUiLabels } from './ui-labels'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'

export const PAGE_SIZES = [25, 50, 100] as const

export type PaginationProps = {
  /** 1-based. */
  page: number
  pageSize: number
  /** Rows on this page. */
  shown: number
  /** Every row the filters match, when the API counts them. Unknown leaves the range open. */
  total?: number | null
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  sizes?: readonly number[]
  onPageSizeChange?: (size: number) => void
  loading?: boolean
  className?: string
}

const STEP = cn(
  'flex h-7 items-center gap-1 rounded-[7px] px-2 text-label font-medium text-control outline-none',
  'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
  'hover:bg-fill-hover hover:text-ink-900 focus-visible:shadow-(--shadow-focus)',
  'disabled:pointer-events-none disabled:opacity-40',
)

/**
 * The foot of a list: where you are, how many there are, the way to the next page and how
 * long a page is. SDR's range-and-steps footer, with the page number spelled out because a
 * cursor-paged list cannot jump, and saying «página 3» is how somebody finds their place again.
 */
export function Pagination({
  page,
  pageSize,
  shown,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  sizes = PAGE_SIZES,
  onPageSizeChange,
  loading = false,
  className,
}: PaginationProps) {
  const labels = useUiLabels().lists.pagination
  if (shown === 0 && page === 1 && !hasNext) return null
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1
  const to = (page - 1) * pageSize + shown
  const pages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null
  const range =
    total != null
      ? fillLabel(labels.range, { from: from.toLocaleString('es'), to: to.toLocaleString('es'), total: total.toLocaleString('es') })
      : fillLabel(labels.rangeOpen, { from: from.toLocaleString('es'), to: to.toLocaleString('es') })

  return (
    <div
      aria-busy={loading || undefined}
      data-pagination=""
      className={cn('flex h-10 shrink-0 items-center justify-between gap-3 border-t border-border-subtle', FRAME_GUTTER, className)}
    >
      <span className="min-w-0 truncate text-label tabular-nums text-text-tertiary">{range}</span>
      <div className="flex shrink-0 items-center gap-1">
        {hasPrev || hasNext ? (
          <>
            <button type="button" className={STEP} disabled={!hasPrev || loading} onClick={onPrev} aria-label={labels.previous}>
              <ChevronLeft className="size-3.5" strokeWidth={iconStroke} />
              <span className="hidden sm:inline">{labels.previous}</span>
            </button>
            <span className="px-1 text-label tabular-nums text-text-secondary">
              {pages != null ? fillLabel(labels.pageOf, { page, pages }) : fillLabel(labels.page, { page })}
            </span>
            <button type="button" className={STEP} disabled={!hasNext || loading} onClick={onNext} aria-label={labels.next}>
              <span className="hidden sm:inline">{labels.next}</span>
              <ChevronRight className="size-3.5" strokeWidth={iconStroke} />
            </button>
          </>
        ) : null}
        {onPageSizeChange ? (
          <Select
            size="sm"
            value={String(pageSize)}
            aria-label={labels.rowsPerPage}
            title={labels.rowsPerPage}
            className="ml-1"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </div>
  )
}
