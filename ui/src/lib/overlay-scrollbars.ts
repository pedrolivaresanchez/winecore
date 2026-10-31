/**
 * Overlay scrollbars — a thumb shows while a surface is hovered or scrolling, painted
 * over content so classic scrollbars never steal layout width.
 *
 * Thumbs are `position: fixed` on <body>, placed against the host's
 * `getBoundingClientRect()`: an abspos thumb inside the host pins to `scrollWidth` and
 * floats mid-content the moment that host also overflows sideways.
 *
 * The price of living on <body> is that a thumb cannot tell that its host moved, faded
 * or got covered — so while a thumb is on screen a frame loop re-places and re-audits
 * it, and a host that is mid-transition, occluded or gone loses its thumb on that same
 * frame instead of fading. A scrollbar left hanging in the air after its drawer slid
 * away is the whole reason the loop exists.
 *
 * A thumb paints at `--z-tooltip`, above every dialog and composer. While a portaled
 * layer in the modal band is open, thumbs whose host sits outside that layer are
 * hidden — otherwise a column scroller keeps a bar floating over the portal. Hosts
 * inside the topmost layer keep theirs: that layer's own scrollbar.
 *
 * Opt-outs:
 *   `.scrollbar-inset` — native inset thumb (composer)
 *   `.scrollbar-none`  — no thumb at all
 */

const THUMB_CLASS = 'overlay-scrollbar-thumb'
const THUMB_THICKNESS = 6
const THUMB_MIN = 28
const EDGE_INSET = 2
/** Tail after the last scroll, so momentum and keyboard scrolling keep the thumb. */
const HIDE_MS = 900
/** Hit tests and the opacity walk are the costly half; placement stays per frame. */
const AUDIT_MS = 100
/** Under this the host is mid-fade, and a menu is either on screen or it is not. */
const OPAQUE = 0.99
/** Sub-pixel drift is not a transition. */
const MOVE_EPS = 0.5

type Axis = 'y' | 'x'

interface Box {
  top: number
  left: number
  right: number
  bottom: number
}

/** Middle of a placed thumb — the point that gets hit-tested for occlusion. */
interface Anchor {
  x: number
  y: number
}

interface HostState {
  thumbY: HTMLElement | null
  thumbX: HTMLElement | null
  dragging: boolean
  /** `performance.now()` of the last scroll on this host. */
  scrolledAt: number
  auditedAt: number
  onScreen: boolean
  /** Where the host sat on the previous serviced frame; null when not being serviced. */
  box: Box | null
}

const hosts = new WeakMap<HTMLElement, HostState>()
/** Hosts the frame loop is servicing — strong refs, dropped as soon as one goes quiet. */
const live = new Set<HTMLElement>()
/** Every host that owns a body-level thumb, so an unmount can be collected. */
const tracked = new Set<HTMLElement>()
/**
 * Hosts whose thumb was hidden because a portaled overlay covers them. A mutation
 * (the overlay closing) resumes them, so a still cursor gets its bar back without
 * a fresh pointerover — opening the overlay never sent pointerout either.
 */
const suspended = new Set<HTMLElement>()

let frame = 0
let domDirty = false
/** Last pointer, so a thumb on `<body>` cannot keep a host "hovered" after the cursor left it. */
let pointerX = Number.NaN
let pointerY = Number.NaN
/** Topmost modal-band portal from the last scan. Invalidated when the DOM changes. */
let overlayCache: { top: HTMLElement | null } | null = null

function stateFor(el: HTMLElement): HostState {
  let s = hosts.get(el)
  if (!s) {
    s = {
      thumbY: null,
      thumbX: null,
      dragging: false,
      scrolledAt: 0,
      auditedAt: 0,
      onScreen: true,
      box: null,
    }
    hosts.set(el, s)
  }
  return s
}

function prefersNative(el: HTMLElement) {
  return el.classList.contains('scrollbar-inset') || el.classList.contains('scrollbar-none')
}

/** Drop body-level thumbs when the scroll host is gone or no longer scrollable. */
function destroy(el: HTMLElement) {
  const s = hosts.get(el)
  if (s) {
    s.thumbY?.remove()
    s.thumbX?.remove()
    hosts.delete(el)
  }
  live.delete(el)
  tracked.delete(el)
  suspended.delete(el)
}

function pruneDisconnected() {
  for (const el of tracked) {
    if (!el.isConnected) destroy(el)
  }
  for (const el of suspended) {
    if (!el.isConnected) destroy(el)
  }
}

function overflowAllows(el: HTMLElement, axis: Axis) {
  const s = getComputedStyle(el)
  const value = axis === 'y' ? s.overflowY : s.overflowX
  return value === 'auto' || value === 'scroll' || value === 'overlay'
}

function canScrollY(el: HTMLElement) {
  return overflowAllows(el, 'y') && el.scrollHeight > el.clientHeight + 1
}

function canScrollX(el: HTMLElement) {
  return overflowAllows(el, 'x') && el.scrollWidth > el.clientWidth + 1
}

function makeThumb(axis: Axis) {
  const thumb = document.createElement('div')
  thumb.className = THUMB_CLASS
  thumb.dataset.axis = axis
  thumb.setAttribute('aria-hidden', 'true')
  return thumb
}

function ensureThumbs(el: HTMLElement) {
  const s = stateFor(el)
  /* Always paint on <body> with position:fixed — never as a child of the
     scroll host (abspos inside overflow pins to scrollWidth, not the viewport). */
  const parent = document.body

  if (canScrollY(el)) {
    if (!s.thumbY) {
      s.thumbY = makeThumb('y')
      bindDrag(el, s.thumbY, 'y')
      parent.appendChild(s.thumbY)
      tracked.add(el)
    }
  } else if (s.thumbY) {
    s.thumbY.remove()
    s.thumbY = null
  }

  if (canScrollX(el)) {
    if (!s.thumbX) {
      s.thumbX = makeThumb('x')
      bindDrag(el, s.thumbX, 'x')
      parent.appendChild(s.thumbX)
      tracked.add(el)
    }
  } else if (s.thumbX) {
    s.thumbX.remove()
    s.thumbX = null
  }

  if (!s.thumbY && !s.thumbX) tracked.delete(el)
}

/**
 * The thumb sits inside the host, `EDGE_INSET` px shy of the right edge. Clamped so a
 * narrow host cannot push it past `box.right` onto the sibling beside it.
 */
export function verticalThumbLeft(boxLeft: number, boxRight: number): number {
  const preferred = boxRight - THUMB_THICKNESS - EDGE_INSET
  const maxLeft = boxRight - THUMB_THICKNESS
  return Math.min(maxLeft, Math.max(boxLeft, preferred))
}

/** Same clamp along the bottom edge for a horizontal thumb. */
export function horizontalThumbTop(boxTop: number, boxBottom: number): number {
  const preferred = boxBottom - THUMB_THICKNESS - EDGE_INSET
  const maxTop = boxBottom - THUMB_THICKNESS
  return Math.min(maxTop, Math.max(boxTop, preferred))
}

function placeThumbY(el: HTMLElement, thumb: HTMLElement, box: Box): { anchor: Anchor; size: number } | null {
  const client = el.clientHeight
  const range = el.scrollHeight - client
  if (range <= 0) return null
  const size = Math.max(THUMB_MIN, (client / el.scrollHeight) * client)
  const top = box.top + (el.scrollTop / range) * (client - size)
  const left = verticalThumbLeft(box.left, box.right)

  thumb.style.position = 'fixed'
  thumb.style.width = `${THUMB_THICKNESS}px`
  thumb.style.height = `${size}px`
  thumb.style.top = `${top}px`
  thumb.style.left = `${left}px`
  thumb.style.right = ''
  thumb.style.bottom = ''

  return { anchor: { x: left + THUMB_THICKNESS / 2, y: top + size / 2 }, size }
}

function placeThumbX(el: HTMLElement, thumb: HTMLElement, box: Box): { anchor: Anchor; size: number } | null {
  const client = el.clientWidth
  const range = el.scrollWidth - client
  if (range <= 0) return null
  const size = Math.max(THUMB_MIN, (client / el.scrollWidth) * client)
  const left = box.left + (el.scrollLeft / range) * (client - size)
  const top = horizontalThumbTop(box.top, box.bottom)

  thumb.style.position = 'fixed'
  thumb.style.height = `${THUMB_THICKNESS}px`
  thumb.style.width = `${size}px`
  thumb.style.left = `${left}px`
  thumb.style.top = `${top}px`
  thumb.style.right = ''
  thumb.style.bottom = ''

  return { anchor: { x: left + size / 2, y: top + THUMB_THICKNESS / 2 }, size }
}

function moved(a: Box, b: Box) {
  return (
    Math.abs(a.top - b.top) > MOVE_EPS ||
    Math.abs(a.left - b.left) > MOVE_EPS ||
    Math.abs(a.right - b.right) > MOVE_EPS ||
    Math.abs(a.bottom - b.bottom) > MOVE_EPS
  )
}

/** Cumulative paint state: a host inside a fading panel is on its way out or in. */
function isPainted(el: HTMLElement) {
  if (!el.isConnected) return false
  let cur: HTMLElement | null = el
  while (cur) {
    const style = getComputedStyle(cur)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (Number(style.opacity) < OPAQUE) return false
    cur = cur.parentElement
  }
  return true
}

/**
 * Centre, both ends, and the outer face of a placed thumb.
 *
 * The centre alone is the host even when an end has slid under a drawer or the outer
 * face has crossed onto the sibling column. One covered probe is enough to drop the bar.
 */
export function thumbProbePoints(axis: Axis, anchor: Anchor, size: number): Anchor[] {
  const reach = Math.max(0, size / 2 - 4)
  const points: Anchor[] = []
  if (axis === 'y') {
    if (reach >= 1) points.push({ x: anchor.x, y: anchor.y - reach })
    points.push(anchor)
    if (reach >= 1) points.push({ x: anchor.x, y: anchor.y + reach })
    points.push({ x: anchor.x + THUMB_THICKNESS / 2 - 0.5, y: anchor.y })
  } else {
    if (reach >= 1) points.push({ x: anchor.x - reach, y: anchor.y })
    points.push(anchor)
    if (reach >= 1) points.push({ x: anchor.x + reach, y: anchor.y })
    points.push({ x: anchor.x, y: anchor.y + THUMB_THICKNESS / 2 - 0.5 })
  }
  return points
}

/**
 * The topmost element under a point covers the host when it is neither the host, a
 * descendant, nor an ancestor. Thumbs are skipped — they are what we are auditing.
 * An empty stack is off-viewport: nothing there to paint over.
 */
export function stackCoversHost(host: Element, stack: readonly Element[]): boolean {
  for (const node of stack) {
    if (node.classList.contains(THUMB_CLASS)) continue
    return !(node === host || host.contains(node) || node.contains(host))
  }
  return false
}

/**
 * Thumbs paint at `--z-tooltip`, over every overlay in the app, so a probe sitting
 * under a menu, drawer or scrim has to give up its thumb rather than draw a scrollbar
 * across it. `elementsFromPoint` ignores `pointer-events: none` layers, which is what
 * we want: a toast or a tooltip floating past is not something to hide from.
 */
function isCovered(el: HTMLElement, anchor: Anchor) {
  return stackCoversHost(el, document.elementsFromPoint(anchor.x, anchor.y))
}

/** Modal band: `--z-index-modal` inclusive, `--z-index-toast` exclusive. */
export function zIndexInOverlayBand(z: number, floor: number, ceiling: number): boolean {
  if (!Number.isFinite(z) || !Number.isFinite(floor) || !Number.isFinite(ceiling)) return false
  if (ceiling <= floor) return false
  return z >= floor && z < ceiling
}

function readZ(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * The topmost portaled layer in the modal band, or null when nothing there is open.
 *
 * Dialogs, drawers, composers, the command palette, the chat card and menus all portal
 * to `<body>` and set `z-index` to a semantic variable (`--z-modal`, `--z-chat-dock`,
 * `--z-dropdown`). Computed `z-index` is the signal — the same variables, resolved —
 * rather than a class name. The toaster is mounted for the whole session at
 * `--z-toast` even when empty, and tooltips sit at `--z-tooltip`, so the band stops
 * below the toast. A closed phone dock is `inert` and does not count.
 */
function findTopmostPortaledOverlay(): HTMLElement | null {
  const floor = readZ('--z-index-modal')
  const ceiling = readZ('--z-index-toast')
  if (!zIndexInOverlayBand(floor, floor, ceiling)) return null
  let top: HTMLElement | null = null
  let topZ = -Infinity
  for (const node of document.body.children) {
    if (!(node instanceof HTMLElement)) continue
    if (node.classList.contains(THUMB_CLASS)) continue
    if (node.inert) continue
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (style.position !== 'fixed' && style.position !== 'absolute') continue
    const z = Number(style.zIndex)
    if (!zIndexInOverlayBand(z, floor, ceiling)) continue
    const rect = node.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) continue
    /* Later siblings paint above an equal z-index, and a higher z-index paints above both. */
    if (z >= topZ) {
      top = node
      topZ = z
    }
  }
  return top
}

function currentOverlay(force: boolean): HTMLElement | null {
  if (!force && overlayCache) {
    if (overlayCache.top && !overlayCache.top.isConnected) overlayCache = null
    else return overlayCache.top
  }
  const top = findTopmostPortaledOverlay()
  overlayCache = { top }
  return top
}

/** True when `el` is outside the topmost modal-band portal, so its thumb would paint across it. */
export function hostBlockedByPortaledOverlay(el: HTMLElement): boolean {
  const top = currentOverlay(false)
  if (!top) return false
  return el !== top && !top.contains(el)
}

/** Tests only — drops the overlay scan so the next check reads the document again. */
export function resetOverlayLayerCache() {
  overlayCache = null
}

export function pointerInsideBox(box: Box, x: number, y: number): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
}

/** The costly half of a frame: throttled, but forced whenever the DOM changed. */
function audit(el: HTMLElement, s: HostState, now: number, dirty: boolean, anchors: Anchor[]) {
  if (!dirty && now - s.auditedAt < AUDIT_MS) return s.onScreen
  s.auditedAt = now
  s.onScreen = isPainted(el) && !anchors.some((anchor) => isCovered(el, anchor))
  return s.onScreen
}

/**
 * `visibility` is deliberately outside the thumb's transition: a surface that went away
 * takes its thumb with it on the same frame, while a reveal still eases in.
 */
function paint(s: HostState, onScreen: boolean) {
  for (const thumb of [s.thumbY, s.thumbX]) {
    if (!thumb) continue
    thumb.style.visibility = onScreen ? '' : 'hidden'
    thumb.classList.toggle('is-visible', onScreen)
    thumb.classList.toggle('is-interactive', onScreen)
  }
}

/** Gone quiet rather than gone: the host is still there, so this one may fade. */
function fadeOut(s: HostState) {
  for (const thumb of [s.thumbY, s.thumbX]) {
    thumb?.classList.remove('is-visible', 'is-interactive')
  }
}

/**
 * Hover comes from the browser's own hit test, not from a flag we keep: an overlay
 * that opens under a still cursor never sends `pointerout`, so a flag set on the way
 * in stays true and pins the thumb on screen for as long as the host lives.
 *
 * The thumb lives on `<body>`, so its own `:hover` used to count after the pointer had
 * slid onto the sibling column. The stick releases once the pointer leaves the host,
 * and once a modal-band portal is covering this host.
 */
function isHovered(el: HTMLElement, s: HostState, top: HTMLElement | null) {
  if (blockedBy(el, top)) return false
  /* <html> is under the pointer whenever the window is, so hover cannot mean anything
     for the page scroller — only a real scroll or a grab shows that one. */
  if (el === document.documentElement) return false
  const overThumb = Boolean(s.thumbY?.matches(':hover') || s.thumbX?.matches(':hover'))
  if (!el.matches(':hover') && !overThumb) return false
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return true
  const rect = el.getBoundingClientRect()
  return pointerInsideBox(
    { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
    pointerX,
    pointerY,
  )
}

function blockedBy(el: HTMLElement, top: HTMLElement | null) {
  return top != null && el !== top && !top.contains(el)
}

/** One frame of work for one host. Returns false when it no longer needs servicing. */
function service(el: HTMLElement, now: number, dirty: boolean, top: HTMLElement | null) {
  if (!el.isConnected || prefersNative(el)) {
    destroy(el)
    return false
  }

  const s = stateFor(el)
  /* Immediate — not the 900ms scroll tail. A composer that opens under a still cursor
     never delivers pointerout, and the thumb is painted above that composer. */
  if (blockedBy(el, top)) {
    paint(s, false)
    s.box = null
    suspended.add(el)
    return false
  }

  ensureThumbs(el)
  if (!s.thumbY && !s.thumbX) {
    s.box = null
    return false
  }

  if (!s.dragging && !isHovered(el, s, top) && now - s.scrolledAt >= HIDE_MS) {
    fadeOut(s)
    s.box = null
    return false
  }

  const rect = el.getBoundingClientRect()
  const box = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom }
  /* A box that changed since the last frame means the surface is in transit — a drawer
     sliding out, a column giving up width. The thumb would ride along a frame behind
     and read as debris, so it goes now and comes back once the surface settles. */
  const settled = !s.box || !moved(s.box, box)
  s.box = box

  const anchors: Anchor[] = []
  if (s.thumbY) {
    const placed = placeThumbY(el, s.thumbY, box)
    if (placed) anchors.push(...thumbProbePoints('y', placed.anchor, placed.size))
  }
  if (s.thumbX) {
    const placed = placeThumbX(el, s.thumbX, box)
    if (placed) anchors.push(...thumbProbePoints('x', placed.anchor, placed.size))
  }

  paint(s, settled && audit(el, s, now, dirty, anchors))
  return true
}

function resumeSuspended(top: HTMLElement | null) {
  for (const el of [...suspended]) {
    if (!el.isConnected || prefersNative(el)) {
      destroy(el)
      continue
    }
    if (blockedBy(el, top)) continue
    suspended.delete(el)
    if (!canScrollY(el) && !canScrollX(el)) continue
    const s = stateFor(el)
    s.auditedAt = 0
    live.add(el)
  }
}

function tick() {
  frame = 0
  const dirty = domDirty
  domDirty = false
  if (dirty) {
    pruneDisconnected()
    overlayCache = null
  }

  const now = performance.now()
  const top = currentOverlay(dirty)
  if (dirty) resumeSuspended(top)
  for (const el of [...live]) {
    if (!service(el, now, dirty, top)) live.delete(el)
  }

  if (live.size > 0) schedule()
}

function schedule() {
  if (frame === 0) frame = requestAnimationFrame(tick)
}

function reveal(el: HTMLElement, scrolled: boolean) {
  if (!el.isConnected || prefersNative(el)) {
    destroy(el)
    return
  }
  if (hostBlockedByPortaledOverlay(el)) {
    const s = hosts.get(el)
    if (s) {
      paint(s, false)
      s.box = null
    }
    suspended.add(el)
    if (scrolled) stateFor(el).scrolledAt = performance.now()
    return
  }
  suspended.delete(el)
  if (!canScrollY(el) && !canScrollX(el)) return
  const s = stateFor(el)
  if (scrolled) s.scrolledAt = performance.now()
  /* Whatever was covering this host last time may be gone — look again. */
  s.auditedAt = 0
  live.add(el)
  schedule()
}

function bindDrag(el: HTMLElement, thumb: HTMLElement, axis: Axis) {
  thumb.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const s = stateFor(el)
    s.dragging = true
    thumb.setPointerCapture(event.pointerId)
    live.add(el)
    schedule()

    const start = axis === 'y' ? event.clientY : event.clientX
    const startScroll = axis === 'y' ? el.scrollTop : el.scrollLeft
    const client = axis === 'y' ? el.clientHeight : el.clientWidth
    const scrollSize = axis === 'y' ? el.scrollHeight : el.scrollWidth
    const thumbSize = axis === 'y' ? thumb.offsetHeight : thumb.offsetWidth
    const scrollRange = scrollSize - client
    const thumbRange = Math.max(1, client - thumbSize)

    const onMove = (move: PointerEvent) => {
      const delta = (axis === 'y' ? move.clientY : move.clientX) - start
      const next = startScroll + (delta / thumbRange) * scrollRange
      if (axis === 'y') el.scrollTop = next
      else el.scrollLeft = next
    }

    const onUp = () => {
      s.dragging = false
      s.scrolledAt = performance.now()
      thumb.removeEventListener('pointermove', onMove)
      thumb.removeEventListener('pointerup', onUp)
      thumb.removeEventListener('pointercancel', onUp)
    }

    thumb.addEventListener('pointermove', onMove)
    thumb.addEventListener('pointerup', onUp)
    thumb.addEventListener('pointercancel', onUp)
  })
}

function hostsFromNode(node: EventTarget | null): HTMLElement[] {
  const found: HTMLElement[] = []
  let cur: Element | null = node instanceof Element ? node : null

  while (cur) {
    if (
      cur instanceof HTMLElement &&
      !prefersNative(cur) &&
      (canScrollY(cur) || canScrollX(cur))
    ) {
      found.push(cur)
    }
    cur = cur.parentElement
  }

  return found
}

function onScroll(event: Event) {
  const target = event.target
  const el =
    target === document || target === document.documentElement || target === document.body
      ? document.documentElement
      : target instanceof HTMLElement
        ? target
        : null
  if (!el) return
  reveal(el, true)
}

function rememberPointer(event: PointerEvent) {
  pointerX = event.clientX
  pointerY = event.clientY
}

function onPointerOver(event: PointerEvent) {
  rememberPointer(event)
  for (const el of hostsFromNode(event.target)) reveal(el, false)
}

/** The pointer left the window — the last coordinates are no longer over a host. */
function onPointerLeave(event: PointerEvent) {
  if (event.relatedTarget) return
  pointerX = Number.NaN
  pointerY = Number.NaN
}

/** The viewport moved under every fixed thumb, so nobody's audit still holds. */
function onViewportChange() {
  domDirty = true
  overlayCache = null
  schedule()
}

export function initOverlayScrollbars() {
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointermove', rememberPointer, { capture: true, passive: true })
  document.addEventListener('pointerout', onPointerLeave, true)
  window.addEventListener('resize', onViewportChange)
  /* Mobile address-bar show/hide and visual viewport shifts. */
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('scroll', onViewportChange)

  const ro = new ResizeObserver(onViewportChange)
  ro.observe(document.documentElement)

  /* Menus and drawers unmount without a reliable pointerout, and a thumb whose host
     is gone would otherwise float forever at the last rect it was placed at. */
  const mo = new MutationObserver(onViewportChange)
  mo.observe(document.documentElement, { childList: true, subtree: true })
}
