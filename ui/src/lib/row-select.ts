/**
 * Spreadsheet-style row selection.
 *
 * A click plants an origin. Shift-click, and a drag, paint every row between that
 * origin and the pointer onto a snapshot of the selection at plant time — so extending
 * to row 12 and then back to row 7 drops 8–12 the way Excel does, without touching
 * ticks that were already there before the gesture. The polarity is the origin's: press
 * an empty box to tick a run, press a ticked one to clear it.
 *
 * Empty keys are holes (a sheet row with nothing to tick) and are skipped.
 */

export type RowSelectGesture = {
  origin: number
  next: boolean
  snapshot: ReadonlySet<string>
}

export function paintKeyRange(
  keys: readonly string[],
  selected: ReadonlySet<string>,
  from: number,
  to: number,
  next: boolean,
): Set<string> {
  const set = new Set(selected)
  if (keys.length === 0) return set
  const lo = Math.max(0, Math.min(from, to))
  const hi = Math.min(keys.length - 1, Math.max(from, to))
  if (lo > hi) return set
  for (let i = lo; i <= hi; i++) {
    const key = keys[i]
    if (!key) continue
    if (next) set.add(key)
    else set.delete(key)
  }
  return set
}

export function beginRowSelect(
  keys: readonly string[],
  selected: ReadonlySet<string>,
  index: number,
): { selected: Set<string>; gesture: RowSelectGesture } | null {
  const key = keys[index]
  if (!key) return null
  return beginRowSelectWith(keys, selected, index, !selected.has(key))
}

/**
 * Plant an origin with a chosen polarity. A drag across cells always ticks (`next:
 * true`); a press on a ticked checkbox clears (`next: false`).
 */
export function beginRowSelectWith(
  keys: readonly string[],
  selected: ReadonlySet<string>,
  index: number,
  next: boolean,
): { selected: Set<string>; gesture: RowSelectGesture } | null {
  const key = keys[index]
  if (!key) return null
  const snapshot = new Set(selected)
  const gesture: RowSelectGesture = { origin: index, next, snapshot }
  return {
    selected: paintKeyRange(keys, snapshot, index, index, next),
    gesture,
  }
}

export function extendRowSelect(
  keys: readonly string[],
  gesture: RowSelectGesture,
  index: number,
): Set<string> {
  return paintKeyRange(keys, gesture.snapshot, gesture.origin, index, gesture.next)
}

/**
 * One click on a row tick. Shift extends the planted run; anything else plants a new one.
 */
export function clickRowSelect(
  keys: readonly string[],
  selected: ReadonlySet<string>,
  gesture: RowSelectGesture | null,
  index: number,
  shiftKey: boolean,
): { selected: Set<string>; gesture: RowSelectGesture } | null {
  if (shiftKey && gesture) {
    return { selected: extendRowSelect(keys, gesture, index), gesture }
  }
  return beginRowSelect(keys, selected, index)
}

/**
 * A tick applied on pointer-down must ignore the click the browser still fires on
 * release, or the same row toggles straight back off.
 */
export function armClickSwallow(flag: { current: boolean }) {
  flag.current = true
  const clear = () => {
    window.removeEventListener('pointerup', clear)
    window.removeEventListener('pointercancel', clear)
    window.setTimeout(() => {
      flag.current = false
    }, 0)
  }
  window.addEventListener('pointerup', clear)
  window.addEventListener('pointercancel', clear)
}
