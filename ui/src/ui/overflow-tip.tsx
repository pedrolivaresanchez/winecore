import { useEffect, useRef, useState } from 'react'
import { INTENT_DELAY_MS, TooltipPanel } from './tooltip'

/** A tip is a line or two, not the place a note is read. */
const MAX_CHARS = 280

/** Where truncated text gets its full value on hover: every table cell, and blocks that opt in. */
const SCOPE = 'td, th, [data-overflow-tip]'
/** Never: a block that already answers hover (a record's hover card), or a field being edited. */
const OPT_OUT = '[data-overflow-tip="off"], input, textarea, select, [contenteditable="true"]'
/** A full-row link laid over the cells; the text a pointer is reading sits under it. */
const OVERLAY = '[data-row-overlay]'

/** True when `el` paints less of its text than it holds: an ellipsis, a clip or a line clamp. */
export function isTruncated(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const style = getComputedStyle(el)
  const clamp = style.getPropertyValue('-webkit-line-clamp')
  if (clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1) return true
  /* A scroller holding more than it shows is a scroller, not a cut. */
  if (style.overflowX === 'visible' || style.overflowX === 'auto' || style.overflowX === 'scroll') {
    return false
  }
  if (el.scrollWidth <= el.clientWidth + 1) return false
  return Boolean(el.textContent?.trim())
}

/** The value a truncated element holds, one line: line breaks between its parts become « · ». */
export function fullText(el: HTMLElement): string {
  const raw = el.innerText || el.textContent || ''
  const text = raw
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ')
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text
}

/**
 * What the tip says for a truncated element. A native `title` around it (a chip's meaning, a
 * list's description) is folded in rather than left to fire a second tooltip a second later:
 * on its own when it already holds the value, after it when it says something else.
 */
export function tipText(el: HTMLElement): string {
  const text = fullText(el)
  const title = el.closest('[title]')?.getAttribute('title')?.trim()
  if (!title || title === text) return text
  return title.includes(text) ? title : `${text} · ${title}`
}

/**
 * The truncated element somebody is reading at `target`: the target itself or its nearest
 * truncated ancestor inside the cell, else — the pointer is on padding or a wrapper — the
 * first truncated thing inside it. Null when nothing there is cut.
 */
export function truncatedAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  if (target.closest(OPT_OUT)) return null
  const scope = target.closest(SCOPE)
  if (!scope) return null
  let found: HTMLElement | null = null
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (isTruncated(node)) {
      found = node
      break
    }
    if (node === scope) break
  }
  if (!found) {
    for (const node of target.querySelectorAll('*')) {
      if (node.closest(OPT_OUT)) continue
      if (isTruncated(node)) {
        found = node
        break
      }
    }
  }
  if (!found) return null
  return fullText(found) ? found : null
}

/** Lifts a native `title` off while the tip speaks for it; hands it back unless React re-set it. */
function muteTitle(el: HTMLElement): () => void {
  const titled = el.closest<HTMLElement>('[title]')
  const title = titled?.getAttribute('title')
  if (!titled || title == null) return () => {}
  titled.removeAttribute('title')
  return () => {
    if (!titled.hasAttribute('title')) titled.setAttribute('title', title)
  }
}

/** What is under the pointer once a row link laid over the cells is looked through. */
function underPointer(event: PointerEvent): Element | null {
  const target = event.target
  if (!(target instanceof Element) || !target.closest(OVERLAY)) return target as Element | null
  if (typeof document.elementsFromPoint !== 'function') return null
  return document.elementsFromPoint(event.clientX, event.clientY).find((el) => !el.closest(OVERLAY)) ?? null
}

/**
 * The full value of anything truncated in a table, on hover and on keyboard focus.
 *
 * Mounted once at the app root. A cell that ellipsizes a long name, a header too narrow
 * for its label, a chip cut to «Initial meeting co…»: the pointer resting on it gets the
 * whole value in the tooltip recipe, a keyboard landing on it gets it at once. Nothing
 * is added to the cells, so `Table`, `DataGrid` and the hand-built tables all answer the
 * same way. Outside a table a block opts in with `data-overflow-tip`; a block that
 * already answers hover opts out with `data-overflow-tip="off"`.
 *
 * The panel is `aria-hidden`: truncation only paints the value short, the text is whole
 * in the DOM, so a screen reader already reads all of it and would hear it twice.
 */
export function OverflowTips() {
  const [tip, setTip] = useState<string | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let frame = 0
    let current: HTMLElement | null = null
    let unmute = () => {}

    const reset = () => {
      window.clearTimeout(timer)
      unmute()
      unmute = () => {}
      anchorRef.current = null
      setTip(null)
    }
    const close = () => {
      current = null
      reset()
    }

    const consider = (target: Element | null, immediate: boolean) => {
      const found = truncatedAt(target)
      if (found === current) return
      reset()
      current = found
      if (!found) return
      timer = window.setTimeout(
        () => {
          if (current !== found || !found.isConnected) return
          const text = tipText(found)
          unmute = muteTitle(found)
          anchorRef.current = found
          setTip(text)
        },
        immediate ? 0 : INTENT_DELAY_MS,
      )
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => consider(underPointer(event), false))
    }
    const onLeave = (event: PointerEvent) => {
      if (!event.relatedTarget) close()
    }
    const onFocus = (event: FocusEvent) => consider(event.target as Element | null, true)

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerout', onLeave)
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', close)
    document.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      unmute()
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onLeave)
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', close)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
    }
  }, [])

  return (
    <TooltipPanel
      anchorRef={anchorRef}
      open={tip !== null}
      label={tip ?? ''}
      ariaHidden
      className="max-w-80"
    />
  )
}
