import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from './icons'
import { GlassMenu, useMenuOpen } from './glass-menu'
import { MenuItem } from './menu'
import { textureSecondary } from './button'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'
import { civilDay, displayTimezone, pad, splitDateTime } from '../lib/civil-date'
import {
  civilDayOf,
  formatCivilDay,
  formatCivilRange,
  pickRangeDay,
  previewRange,
  rangeDayRole,
  type DateRange,
} from './date-range'

export type { DateRange } from './date-range'

export type DatePickerShortcut = { label: string; day: string }

export type DatePickerProps = {
  /** ISO date (`2026-08-16`) or datetime. Null is an empty field. */
  value: string | null
  onChange: (next: string | null) => void
  /** Adds a time field below the grid, for meetings and reminders. */
  withTime?: boolean
  placeholder?: string
  disabled?: boolean
  /** BCP-47 tag, so month and weekday names follow the app language. */
  locale?: string
  /** `{ clear, today, time }` — every string comes from the caller. */
  labels?: { clear: string; today: string; time?: string }
  size?: 'sm' | 'md'
  className?: string
  /**
   * Drop the white field face. Used when the trigger sits inside another control's
   * chrome — the record rail's focus pill — so the calendar button is just a label.
   */
  plain?: boolean
  /** Relative jumps (tomorrow, in a week) listed above the grid. */
  shortcuts?: DatePickerShortcut[]
  /**
   * Always shown on the trigger instead of the formatted date. For a verb button
   * (Reschedule) that opens a calendar without becoming a date field.
   */
  triggerLabel?: string
  /** IANA zone for "today" and for reading zoned ISO values. Browser local when omitted. */
  timeZone?: string
}

const sizes = {
  sm: 'h-7 rounded-[7px] px-2.5 text-label max-sm:h-11',
  md: 'h-8 rounded-md px-2.5 text-body max-sm:h-11',
}

/**
 * A calendar in a `GlassMenu`, not a native `<input type="date">`.
 *
 * The native control cannot be styled past its border and renders differently in every
 * browser, which for a field that appears on every record page and in every filter row
 * means the design system stops applying exactly where the app is densest.
 *
 * Dates are stored as `YYYY-MM-DD` or naive `YYYY-MM-DDTHH:mm`. A zoned ISO from the
 * API (`…Z` or an offset) is converted to the given zone's civil day and clock — never
 * shown as the UTC prefix, or a 22:00 UTC due lands on the next morning in Spain.
 * Midnight UTC is a date-only value (HubSpot's convention), not 00:00.
 */
export function DatePicker({
  value,
  onChange,
  withTime = false,
  placeholder,
  disabled,
  locale = 'es',
  labels = { clear: 'Clear', today: 'Today' },
  size = 'md',
  className,
  plain,
  shortcuts,
  triggerLabel,
  timeZone,
}: DatePickerProps) {
  const zone = timeZone ?? displayTimezone()
  const menu = useMenuOpen()
  const selected = datePart(value, zone)
  const time = timePart(value, zone)

  const [cursor, setCursor] = useState(() => monthStart(selected ?? todayIso(zone)))

  const shortcutDay = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
    [locale],
  )
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
    [locale],
  )
  const weekdays = useMemo(() => weekdayNames(locale), [locale])

  const commit = (day: string | null) => {
    if (!day) {
      onChange(null)
      return
    }
    onChange(withTime ? `${day}T${time ?? '09:00'}` : day)
  }

  const label =
    triggerLabel ??
    (selected
      ? `${formatCivilDay(selected, locale)}${withTime && time ? ` · ${time}` : ''}`
      : (placeholder ?? ''))

  return (
    <GlassMenu
      open={menu.open && !disabled}
      onOpenChange={menu.setOpen}
      placement="bottom-start"
      className={className}
      panelClassName="w-64"
      trigger={
        <button
          type="button"
          disabled={disabled}
          onClick={menu.toggle}
          aria-label={triggerLabel || undefined}
          className={cn(
            'inline-flex items-center gap-2 font-medium',
            triggerLabel ? 'w-auto' : 'w-full',
            disabled && 'pointer-events-none opacity-45',
            plain
              ? cn(
                  'h-full min-h-0 bg-transparent text-label outline-none',
                  selected || triggerLabel ? 'text-ink-900' : 'text-text-tertiary',
                )
              : cn(
                  textureSecondary,
                  'transition-[background-image,border-color,box-shadow] duration-150 ease-out',
                  'outline-none focus-visible:shadow-(--shadow-focus)',
                  selected || triggerLabel ? 'text-control' : 'text-text-tertiary',
                  sizes[size],
                ),
          )}
        >
          {plain ? null : (
            <Calendar className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          {selected && !triggerLabel ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={labels.clear}
              onClick={(event) => {
                event.stopPropagation()
                commit(null)
              }}
              className="shrink-0 rounded-xs p-0.5 text-icon-muted transition-colors duration-150 hover:text-text max-sm:-mr-2 max-sm:p-3.5"
            >
              <X className="size-3" strokeWidth={2} />
            </span>
          ) : null}
        </button>
      }
    >
      <div className="flex flex-col gap-2 p-1">
        {shortcuts?.length ? (
          <div className="border-b border-border-subtle pb-1">
            {shortcuts.map((item) => (
              <MenuItem
                key={item.day}
                active={item.day === selected}
                trailing={shortcutDay.format(parseIso(item.day))}
                onClick={() => {
                  commit(item.day)
                  setCursor(monthStart(item.day))
                  menu.close()
                }}
              >
                {item.label}
              </MenuItem>
            ))}
          </div>
        ) : null}

        <MonthNav
          cursor={cursor}
          onCursor={setCursor}
          label={monthFormatter.format(parseIso(cursor))}
        />

        <div className="grid grid-cols-7 gap-0.5">
          {weekdays.map((day, i) => (
            <span
              key={`${day}-${i}`}
              className="py-1 text-center text-caption font-medium text-text-tertiary"
            >
              {day}
            </span>
          ))}
          {monthGrid(cursor).map((day) => {
            const inMonth = day.slice(0, 7) === cursor.slice(0, 7)
            const isSelected = day === selected
            const isToday = day === todayIso(zone)
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  commit(day)
                  menu.close()
                }}
                className={cn(
                  'flex size-8 items-center justify-center rounded-md text-label max-sm:size-10',
                  'transition-colors duration-150',
                  isSelected
                    ? 'bg-ink-900 font-medium text-ink-0'
                    : inMonth
                      ? 'text-text hover:bg-fill-hover'
                      : 'text-text-disabled hover:bg-fill-hover',
                  /* Today is marked, not selected. Somebody scanning for "where am I"
                     should not have to read the number. */
                  !isSelected && isToday && 'font-medium text-flame-500',
                )}
              >
                {Number(day.slice(8, 10))}
              </button>
            )
          })}
        </div>

        {withTime ? (
          <input
            type="time"
            value={time ?? ''}
            aria-label={labels.time}
            onChange={(event) => {
              const next = event.target.value
              if (!next) return
              onChange(`${selected ?? todayIso(zone)}T${next}`)
            }}
            className={cn(
              'w-full rounded-md border border-border bg-surface px-2.5',
              'font-medium text-control outline-none',
              size === 'sm' ? 'h-7 text-label max-sm:h-11' : 'h-8 text-body max-sm:h-11',
              'focus-visible:shadow-(--shadow-focus) focus-visible:border-border-strong',
            )}
          />
        ) : null}

        <div className="flex items-center justify-between border-t border-border-subtle pt-1.5">
          <button
            type="button"
            onClick={() => {
              commit(todayIso(zone))
              menu.close()
            }}
            className="rounded-md px-2 py-1 text-label font-medium text-control transition-colors duration-150 hover:bg-fill-hover max-sm:min-h-11 max-sm:px-3"
          >
            {labels.today}
          </button>
          <button
            type="button"
            onClick={() => {
              commit(null)
              menu.close()
            }}
            className="rounded-md px-2 py-1 text-label font-medium text-text-tertiary transition-colors duration-150 hover:bg-fill-hover"
          >
            {labels.clear}
          </button>
        </div>
      </div>
    </GlassMenu>
  )
}

function MonthNav({
  cursor,
  onCursor,
  label,
}: {
  cursor: string
  onCursor: (next: string) => void
  label: string
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={() => onCursor(addMonths(cursor, -1))}
        className="rounded-md p-1 text-icon transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover"
      >
        <ChevronLeft className="size-3.5" strokeWidth={iconStroke} />
      </button>
      <span className="text-label font-medium text-text capitalize">{label}</span>
      <button
        type="button"
        onClick={() => onCursor(addMonths(cursor, 1))}
        className="rounded-md p-1 text-icon transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover"
      >
        <ChevronRight className="size-3.5" strokeWidth={iconStroke} />
      </button>
    </div>
  )
}

export type DateRangeCalendarProps = {
  from: string | null
  to: string | null
  /**
   * `complete` is true when the click finished the range (second day, Today, or
   * Clear). A first click is already a valid single-day range, but not complete,
   * so a menu can stay open for the other end.
   */
  onChange: (next: DateRange, complete: boolean) => void
  locale?: string
  labels?: { clear: string; today: string }
  timeZone?: string
  className?: string
  /** Announced on the grid. Callers pass the "one click is a day" hint. */
  ariaLabel?: string
}

/**
 * One calendar that is a range, including a single day.
 *
 * Nested date fields cannot do this: picking "from" used to wipe "to", and a day
 * meant filling both boxes with the same date. Click once for that day; click
 * again to open the other end. Hovering while the second click is armed previews
 * the span. The grid is the control, not a pair of inputs that open more menus.
 */
export function DateRangeCalendar({
  from,
  to,
  onChange,
  locale = 'es',
  labels = { clear: 'Clear', today: 'Today' },
  timeZone,
  className,
  ariaLabel,
}: DateRangeCalendarProps) {
  const zone = timeZone ?? displayTimezone()
  const start = civilDayOf(from)
  const end = civilDayOf(to) ?? start
  const emitted = useRef({ from: start, to: end })
  const [picking, setPicking] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [cursor, setCursor] = useState(() => monthStart(start ?? todayIso(zone)))

  useEffect(() => {
    if (start === emitted.current.from && end === emitted.current.to) return
    emitted.current = { from: start, to: end }
    setPicking(false)
    setHover(null)
    if (start) setCursor(monthStart(start))
  }, [start, end])

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
    [locale],
  )
  const weekdays = useMemo(() => weekdayNames(locale), [locale])
  const span = previewRange({ from: start, to: end, picking }, hover)

  const emit = (next: DateRange, complete: boolean) => {
    emitted.current = { from: civilDayOf(next.from), to: civilDayOf(next.to) ?? civilDayOf(next.from) }
    onChange(next, complete)
  }

  const pick = (day: string) => {
    const next = pickRangeDay({ from: start, to: end, picking }, day)
    emitted.current = { from: next.from, to: next.to }
    setPicking(next.picking)
    setHover(null)
    onChange({ from: next.from, to: next.to }, !next.picking)
  }

  return (
    <div className={cn('flex flex-col gap-2 p-1', className)}>
      <MonthNav
        cursor={cursor}
        onCursor={setCursor}
        label={monthFormatter.format(parseIso(cursor))}
      />

      <div
        className="grid grid-cols-7"
        role="grid"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {weekdays.map((day, i) => (
          <span
            key={`${day}-${i}`}
            className="py-1 text-center text-caption font-medium text-text-tertiary"
          >
            {day}
          </span>
        ))}
        {monthGrid(cursor).map((day) => {
          const inMonth = day.slice(0, 7) === cursor.slice(0, 7)
          const role = rangeDayRole(day, span.from, span.to)
          const isToday = day === todayIso(zone)
          const painted = role !== 'none'
          return (
            <button
              key={day}
              type="button"
              onClick={() => pick(day)}
              onMouseEnter={() => picking && setHover(day)}
              aria-pressed={painted}
              className={cn(
                'flex size-8 items-center justify-center text-label',
                'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
                role === 'middle' && 'bg-fill-selected',
                role === 'start' && 'rounded-l-md bg-ink-900 font-medium text-ink-0',
                role === 'end' && 'rounded-r-md bg-ink-900 font-medium text-ink-0',
                role === 'single' && 'rounded-md bg-ink-900 font-medium text-ink-0',
                !painted && inMonth && 'rounded-md text-text hover:bg-fill-hover',
                !painted && !inMonth && 'rounded-md text-text-disabled hover:bg-fill-hover',
                !painted && isToday && 'font-medium text-flame-500',
              )}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border-subtle pt-1.5">
        <button
          type="button"
          onClick={() => {
            const day = todayIso(zone)
            setPicking(false)
            setHover(null)
            setCursor(monthStart(day))
            emit({ from: day, to: day }, true)
          }}
          className="rounded-md px-2 py-1 text-label font-medium text-control transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover"
        >
          {labels.today}
        </button>
        <button
          type="button"
          onClick={() => {
            setPicking(false)
            setHover(null)
            emit({ from: null, to: null }, true)
          }}
          className="rounded-md px-2 py-1 text-label font-medium text-text-tertiary transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:bg-fill-hover"
        >
          {labels.clear}
        </button>
      </div>
    </div>
  )
}

export type DateRangePickerProps = {
  from: string | null
  to: string | null
  onChange: (next: DateRange) => void
  placeholder?: string
  disabled?: boolean
  locale?: string
  labels?: { clear: string; today: string }
  size?: 'sm' | 'md'
  className?: string
  plain?: boolean
  timeZone?: string
  ariaLabel?: string
}

/**
 * `DatePicker` for a span. The trigger shows one day or `01/01/2026 - 31/10/2026`;
 * the panel is `DateRangeCalendar`, not two nested date fields.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder,
  disabled,
  locale = 'es',
  labels = { clear: 'Clear', today: 'Today' },
  size = 'md',
  className,
  plain,
  timeZone,
  ariaLabel,
}: DateRangePickerProps) {
  const menu = useMenuOpen()
  const summary = formatCivilRange(from, to, locale)

  return (
    <GlassMenu
      open={menu.open && !disabled}
      onOpenChange={menu.setOpen}
      placement="bottom-start"
      className={className}
      panelClassName="w-64"
      trigger={
        <button
          type="button"
          disabled={disabled}
          onClick={menu.toggle}
          className={cn(
            'inline-flex w-full items-center gap-2 font-medium',
            disabled && 'pointer-events-none opacity-45',
            plain
              ? cn(
                  'h-full min-h-0 bg-transparent text-label outline-none',
                  summary ? 'text-ink-900' : 'text-text-tertiary',
                )
              : cn(
                  textureSecondary,
                  'transition-[background-image,border-color,box-shadow] duration-(--duration-quick) ease-(--ease-smooth-out)',
                  'outline-none focus-visible:shadow-(--shadow-focus)',
                  summary ? 'text-control' : 'text-text-tertiary',
                  sizes[size],
                ),
          )}
        >
          {plain ? null : (
            <Calendar className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{summary ?? placeholder ?? ''}</span>
          {summary ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={labels.clear}
              onClick={(event) => {
                event.stopPropagation()
                onChange({ from: null, to: null })
              }}
              className="shrink-0 rounded-xs p-0.5 text-icon-muted transition-colors duration-(--duration-quick) hover:text-text max-sm:-mr-2 max-sm:p-3.5"
            >
              <X className="size-3" strokeWidth={2} />
            </span>
          ) : null}
        </button>
      }
    >
      <DateRangeCalendar
        from={from}
        to={to}
        onChange={(next, complete) => {
          onChange(next)
          if (complete) menu.close()
        }}
        locale={locale}
        labels={labels}
        timeZone={timeZone}
        ariaLabel={ariaLabel}
      />
    </GlassMenu>
  )
}

// ---------------------------------------------------------------------------
// Date helpers, all string-in string-out
// ---------------------------------------------------------------------------

function todayIso(timeZone?: string): string {
  return civilDay(new Date(), timeZone)
}

function datePart(value: string | null, timeZone?: string): string | null {
  return splitDateTime(value, timeZone)?.day ?? null
}

function timePart(value: string | null, timeZone?: string): string | null {
  return splitDateTime(value, timeZone)?.time ?? null
}

/** Midday, so a UTC-shifting environment cannot roll the date over. */
function parseIso(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12)
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

function addMonths(day: string, delta: number): string {
  const date = parseIso(day)
  date.setMonth(date.getMonth() + delta, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`
}

/** Monday-first, matching the calendar the SDR surfaces already use. */
function weekdayNames(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
  return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 1 + i)))
}

/** Six weeks from the Monday on or before the 1st: a stable grid that never reflows. */
function monthGrid(monthDay: string): string[] {
  const first = parseIso(monthStart(monthDay))
  const weekday = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - weekday)

  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  })
}
