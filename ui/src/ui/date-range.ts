import { splitDateTime } from '../lib/civil-date'

/**
 * Civil-day ranges. One click is a day; a second click opens the other end.
 *
 * Two stacked date fields cannot say "just the 28th": filling one side used to wipe
 * the other, and a single day meant typing the same date twice. The calendar stores
 * `from` and `to` as the same day until somebody picks another.
 */

export type DateRange = { from: string | null; to: string | null }

export type RangePick = DateRange & {
  /** True after the first click, while the next click completes the other end. */
  picking: boolean
}

/** The `YYYY-MM-DD` of a stored date or datetime. */
export function civilDayOf(value: string | null | undefined): string | null {
  if (!value) return null
  return splitDateTime(value)?.day ?? null
}

export function orderedRange(a: string, b: string): { from: string; to: string } {
  return a <= b ? { from: a, to: b } : { from: b, to: a }
}

/** Inclusive civil-day span. The 28th to the 28th is one day. */
export function civilDaysInclusive(from: string, to: string): number {
  const start = Date.parse(`${from}T12:00:00`)
  const end = Date.parse(`${to}T12:00:00`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.round(Math.abs(end - start) / 86_400_000) + 1
}

/**
 * Click a day on a range calendar.
 *
 * The first click is a complete single-day range (`from === to`). The next click,
 * if different, becomes the other end; if the same, it just locks the day. After
 * that, a click starts over — otherwise a finished range could never be replaced.
 */
export function pickRangeDay(state: RangePick, day: string): RangePick {
  if (!state.picking || !state.from) {
    return { from: day, to: day, picking: true }
  }
  const { from, to } = orderedRange(state.from, day)
  return { from, to, picking: false }
}

/** While picking, hovering a day previews the range that a click would commit. */
export function previewRange(state: RangePick, hover: string | null): DateRange {
  if (!hover || !state.picking || !state.from) {
    return { from: state.from, to: state.to }
  }
  return orderedRange(state.from, hover)
}

export type RangeDayRole = 'none' | 'single' | 'start' | 'end' | 'middle'

export function rangeDayRole(day: string, from: string | null, to: string | null): RangeDayRole {
  if (!from || !to) return 'none'
  if (from === to) return day === from ? 'single' : 'none'
  if (day === from) return 'start'
  if (day === to) return 'end'
  if (day > from && day < to) return 'middle'
  return 'none'
}

export function formatCivilDay(
  day: string,
  locale: string,
  year: 'always' | 'auto' = 'auto',
): string {
  const key = civilDayOf(day)
  if (!key) return day
  const date = new Date(`${key}T12:00:00`)
  if (Number.isNaN(date.getTime())) return key
  const includeYear = year === 'always' || date.getFullYear() !== new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(date)
}

/** One day as itself; two days as `28 ago - 4 sep`. Null when nothing is chosen. */
export function formatCivilRange(
  from: string | null,
  to: string | null,
  locale: string,
): string | null {
  const start = civilDayOf(from)
  if (!start) return null
  const end = civilDayOf(to) ?? start
  if (start === end) return formatCivilDay(start, locale)
  return `${formatCivilDay(start, locale)} - ${formatCivilDay(end, locale)}`
}
