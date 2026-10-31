/**
 * Civil dates vs instants.
 *
 * HubSpot date properties (and date-only task dues) are midnight UTC for that calendar
 * day. Converting that instant to a local clock makes a due on the 26th look like 02:00
 * in Madrid — and overdue from 02:00 on the day it is due. UTC midnight is therefore a
 * date, not a time.
 */

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Zone the CRM is currently dating in. Set by `CrmProvider` from the profile. */
let displayZone: string | undefined

export function setDisplayTimezone(zone: string | undefined): void {
  displayZone = zone
}

export function displayTimezone(): string {
  return displayZone || browserTimezone()
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function isZonedIso(value: string): boolean {
  const s = value.trim()
  if (/Z$/i.test(s)) return true
  return /[T ]\d{2}:\d{2}.*[+-]\d{2}(:?\d{2})?$/.test(s)
}

export function isUtcMidnight(value: string | Date): boolean {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0
}

export function utcDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function civilDay(instant: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${read('year')}-${read('month')}-${read('day')}`
}

export function civilTime(instant: Date, timeZone?: string): string {
  if (!timeZone) {
    return `${pad(instant.getHours())}:${pad(instant.getMinutes())}`
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${read('hour')}:${read('minute')}`
}

/** Day + optional clock for a stored value. UTC midnight is a civil date, not 00:00. */
export function splitDateTime(
  value: string | null | undefined,
  timeZone?: string,
): { day: string; time: string | null } | null {
  if (!value) return null
  if (isZonedIso(value)) {
    if (isUtcMidnight(value)) {
      const day = utcDateKey(value)
      return day ? { day, time: null } : null
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return { day: civilDay(date, timeZone), time: civilTime(date, timeZone) }
  }
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1]
  if (!day) return null
  const time = /[T ](\d{2}:\d{2})/.exec(value)?.[1] ?? null
  return { day, time }
}
