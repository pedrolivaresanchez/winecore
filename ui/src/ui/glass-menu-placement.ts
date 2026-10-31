/**
 * Where a `GlassMenu` panel sits relative to its trigger.
 *
 * Vertical placements (`bottom-start`) drop under the control — filters, selects, the
 * Columns chip itself. Horizontal ones (`right-start`) are for a submenu: the parent
 * list stays on screen and the next choice grows beside the row that asked for it.
 * Stacking that second panel over the first is what made "Add attribute" feel like it
 * had replaced the columns you were editing.
 */
export type MenuPlacement =
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'right-start'
  | 'right-end'
  | 'left-start'
  | 'left-end'

export type MenuCoords = {
  top: number
  left: number
  placement: MenuPlacement
  maxHeight: number
}

export const MENU_GAP = 6
export const MENU_EDGE = 8
/** Prefer the side with more room once the gap exceeds this. */
const SPACE_BIAS = 48

type Viewport = { width: number; height: number }

function isHorizontal(placement: MenuPlacement): boolean {
  return placement.startsWith('left') || placement.startsWith('right')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), max)
}

function resolveVertical(
  trigger: DOMRect,
  menuW: number,
  menuH: number,
  preferred: MenuPlacement,
  viewport: Viewport,
): MenuCoords {
  const vw = viewport.width
  const vh = viewport.height
  const [vPref, hPref] = preferred.split('-') as ['top' | 'bottom', 'start' | 'end']

  /* Available room on each side of the trigger — the panel must stay inside
     this band so growing accordions never spill off-screen. */
  const spaceAbove = Math.max(0, trigger.top - MENU_GAP - MENU_EDGE)
  const spaceBelow = Math.max(0, vh - trigger.bottom - MENU_GAP - MENU_EDGE)

  let vertical: 'top' | 'bottom' = vPref
  if (vPref === 'bottom') {
    if (menuH > spaceBelow && spaceAbove > spaceBelow) vertical = 'top'
  } else if (menuH > spaceAbove && spaceBelow > spaceAbove) {
    vertical = 'bottom'
  }

  /* start = menu left-aligned to trigger (opens into space on the right);
     end = menu right-aligned (opens into space on the left). Pick the side
     with more room so rail menus open into the sheet, not the page edge. */
  const roomStart = vw - trigger.left - MENU_EDGE
  const roomEnd = trigger.right - MENU_EDGE
  let horizontal: 'start' | 'end'
  if (Math.abs(roomStart - roomEnd) < SPACE_BIAS) {
    horizontal = hPref
  } else {
    horizontal = roomStart >= roomEnd ? 'start' : 'end'
  }
  if (horizontal === 'start' && roomStart < menuW && roomEnd >= menuW) {
    horizontal = 'end'
  } else if (horizontal === 'end' && roomEnd < menuW && roomStart >= menuW) {
    horizontal = 'start'
  }

  const placement = `${vertical}-${horizontal}` as MenuPlacement

  /* Anchor to the trigger edge, then grow away from it. Cap height to the
     open side so the panel scrolls instead of floating off or clipping. */
  const maxHeight = vertical === 'top' ? spaceAbove : spaceBelow
  const effectiveH = Math.min(menuH, maxHeight)
  const top =
    vertical === 'top' ? trigger.top - MENU_GAP - effectiveH : trigger.bottom + MENU_GAP
  let left = horizontal === 'start' ? trigger.left : trigger.right - menuW

  left = clamp(left, MENU_EDGE, Math.max(MENU_EDGE, vw - menuW - MENU_EDGE))

  return { top, left, placement, maxHeight }
}

function resolveHorizontal(
  trigger: DOMRect,
  menuW: number,
  menuH: number,
  preferred: MenuPlacement,
  viewport: Viewport,
): MenuCoords {
  const vw = viewport.width
  const vh = viewport.height
  const [hPref, vAlign] = preferred.split('-') as ['left' | 'right', 'start' | 'end']

  const spaceRight = Math.max(0, vw - trigger.right - MENU_GAP - MENU_EDGE)
  const spaceLeft = Math.max(0, trigger.left - MENU_GAP - MENU_EDGE)

  /* Same bias as start/end on a vertical menu: sit on the side with more room so a
     cascade keeps growing away from the parent instead of folding back over it.
     The Columns chip lives on the right of the view bar; a submenu that always
     honoured "right" would flip once, then the next group would open back over
     the column list. */
  let horizontal: 'left' | 'right'
  if (Math.abs(spaceRight - spaceLeft) < SPACE_BIAS) {
    horizontal = hPref
  } else {
    horizontal = spaceRight >= spaceLeft ? 'right' : 'left'
  }
  if (horizontal === 'right' && menuW > spaceRight && spaceLeft >= menuW) {
    horizontal = 'left'
  } else if (horizontal === 'left' && menuW > spaceLeft && spaceRight >= menuW) {
    horizontal = 'right'
  }

  const { top, align, maxHeight } = resolveSidePanelTop(trigger, menuH, vAlign, vh)

  let left =
    horizontal === 'right' ? trigger.right + MENU_GAP : trigger.left - MENU_GAP - menuW
  left = clamp(left, MENU_EDGE, Math.max(MENU_EDGE, vw - menuW - MENU_EDGE))

  const placement = `${horizontal}-${align}` as MenuPlacement
  return { top, left, placement, maxHeight }
}

/**
 * Where a panel that opens beside a row sits vertically: a submenu, the chat's effort
 * flyout. It hangs from the row's top edge when that fits, and stands on the row's
 * bottom edge when it does not and there is more room upward, so a row near the bottom
 * of the window still opens a panel you can reach. Only a panel that fits neither way is
 * shifted onto the screen, and one taller than the viewport is capped so it scrolls.
 *
 * A side panel can use the full viewport height; it sits beside the row, so it does not
 * have to share the band above or below it.
 */
export function resolveSidePanelTop(
  row: { top: number; bottom: number },
  panelH: number,
  preferred: 'start' | 'end',
  viewportHeight: number,
): { top: number; align: 'start' | 'end'; maxHeight: number } {
  const maxHeight = Math.max(0, viewportHeight - MENU_EDGE * 2)
  const h = Math.min(panelH, maxHeight)
  const roomDown = viewportHeight - MENU_EDGE - row.top
  const roomUp = row.bottom - MENU_EDGE

  let align = preferred
  if (preferred === 'start' && h > roomDown && (h <= roomUp || roomUp > roomDown)) {
    align = 'end'
  } else if (preferred === 'end' && h > roomUp && (h <= roomDown || roomDown > roomUp)) {
    align = 'start'
  }

  const anchored = align === 'start' ? row.top : row.bottom - h
  const top = clamp(anchored, MENU_EDGE, Math.max(MENU_EDGE, viewportHeight - MENU_EDGE - h))
  return { top, align, maxHeight }
}

/**
 * Resolve a menu's on-screen box. Viewport is injectable so the flip rules can be
 * tested without a window.
 */
export function resolveMenuPlacement(
  trigger: DOMRect,
  menuW: number,
  menuH: number,
  preferred: MenuPlacement,
  viewport: Viewport = typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight },
): MenuCoords {
  if (isHorizontal(preferred)) {
    return resolveHorizontal(trigger, menuW, menuH, preferred, viewport)
  }
  return resolveVertical(trigger, menuW, menuH, preferred, viewport)
}
