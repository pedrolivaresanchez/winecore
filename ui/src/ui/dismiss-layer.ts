import { useLayoutEffect, useRef } from 'react'
import { useForeignDocument } from './portal-document'

/**
 * Escape for overlays that portal out of the thing that opened them.
 *
 * A React `onKeyDown` on the panel only fires when focus is inside it. Cmd-K then
 * Escape before the input takes the caret — or after a click on the list, or over a
 * dialog that is already trapping keys — is the press that used to vanish. Each overlay
 * also used to bind its own capture listener on `document`, and those run in
 * registration order, so a dialog opened first would close *under* the palette on top.
 *
 * One stack, last-in first-out, one window capture listener. The topmost overlay
 * dismisses; nested menus, palettes over dialogs, and dialogs over drawers peel one
 * layer per press. `useLayoutEffect` so the layer is on the stack before the first
 * paint, which is what makes the immediate Escape after Cmd-K land.
 *
 * A layer belongs to the window it is drawn in. The popped-out chat is this tree in
 * another window, with a listener of its own, and an Escape pressed there peels that
 * window's menus only — never a dialog left open in the tab behind it.
 */

/**
 * Whether this Escape is the layer's to take. A dialog owns every Escape while it is
 * up; a floating surface that shares the page with the workspace (the phone dock) has
 * to leave the press to a grid cell or a search box the rep is typing in.
 */
export type DismissAccepts = (event: DismissKeyEvent) => boolean

/** `null` is the tab; anything else is the other window's document the layer is drawn in. */
export type DismissScope = Document | null

type DismissLayer = { id: number; dismiss: () => void; accepts?: DismissAccepts; scope: DismissScope }

let seq = 0
let listening = false
const layers: DismissLayer[] = []

export type DismissKeyEvent = {
  key: string
  repeat?: boolean
  isComposing?: boolean
  /** IME composition on some engines reports 229 instead of a real key. */
  keyCode?: number
  /** Where the press landed, for layers that yield Escape to a focused field. */
  target?: unknown
  preventDefault: () => void
  stopPropagation: () => void
  stopImmediatePropagation?: () => void
}

function isEscape(event: DismissKeyEvent): boolean {
  return event.key === 'Escape' || event.key === 'Esc'
}

function isComposing(event: DismissKeyEvent): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229
}

function onWindowKey(event: KeyboardEvent) {
  handleDismissKey(event)
}

function bind() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', onWindowKey, true)
}

function unbindIfEmpty() {
  if (layers.length > 0 || !listening || typeof window === 'undefined') return
  listening = false
  window.removeEventListener('keydown', onWindowKey, true)
}

/** Push a dismisser. The last push is the one Escape closes. Returns the pop. */
export function pushDismissLayer(
  dismiss: () => void,
  accepts?: DismissAccepts,
  scope: DismissScope = null,
): () => void {
  const layer: DismissLayer = { id: ++seq, dismiss, accepts, scope }
  layers.push(layer)
  bind()
  return () => {
    const index = layers.findIndex((entry) => entry.id === layer.id)
    if (index >= 0) layers.splice(index, 1)
    unbindIfEmpty()
  }
}

/**
 * Close the top overlay if this key is a real Escape. Returns whether it did.
 *
 * Holding the key must not peel the whole stack — one press, one layer — so
 * repeats are ignored. Composition is left to the IME; the next Escape after
 * it cancels is the one that dismisses. `scope` is the window the key was pressed in.
 */
export function handleDismissKey(event: DismissKeyEvent, scope: DismissScope = null): boolean {
  if (event.repeat) return false
  if (isComposing(event)) return false
  if (!isEscape(event)) return false
  const top = layers.findLast((layer) => layer.scope === scope)
  if (!top) return false
  /* The top layer declining is not a fall-through: the press belongs to whatever the
     layer yielded it to, not to the overlay under it. */
  if (top.accepts && !top.accepts(event)) return false
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation?.()
  top.dismiss()
  return true
}

/** Bind Escape for as long as `active` is true. `onDismiss` is read from a ref so an
 *  unstable closer cannot drop and re-push the layer on every parent render. */
export function useDismissOnEscape(
  active: boolean,
  onDismiss: () => void,
  accepts?: DismissAccepts,
) {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  const acceptsRef = useRef(accepts)
  acceptsRef.current = accepts
  const scope = useForeignDocument()

  useLayoutEffect(() => {
    if (!active) return
    return pushDismissLayer(
      () => onDismissRef.current(),
      (event) => acceptsRef.current?.(event) ?? true,
      scope,
    )
  }, [active, scope])
}

/** Tests only — drops every layer and the window listener. */
export function resetDismissLayers() {
  layers.length = 0
  seq = 0
  unbindIfEmpty()
}
