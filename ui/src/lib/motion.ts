/**
 * Closer motion — the JS mirror of the motion tokens in `src/index.css`.
 *
 * The scale is transitions.dev's, adopted from timbal-platform (`src/design/motion.js`
 * and `.agents/skills/transitions-dev`) so the two products move identically. CSS
 * surfaces read `--duration-*` / `--ease-*` / `--scale-*` directly; anything driven by
 * `motion/react` reads the constants below. Change a token, then change its twin here.
 *
 * The one rule that matters: **match on usage, never on the nearest number.** Infer what
 * the motion does — dropdown open, modal close, sheet, tab slide — then take the recipe
 * whose documented usage matches. A 300ms modal close is `DURATION_QUICK` (150ms) because
 * both are "modal close", even though the numbers disagree.
 *
 * Banned, and these are the mistakes that made our surfaces feel like different products:
 *   - A bespoke duration or cubic-bezier on a surface that has a recipe below.
 *   - A `y` translate on an anchored panel. It grows from its trigger: scale + opacity.
 *   - Per-row stagger inside a menu or a grid. The panel is one surface.
 *   - Bouncing or delaying a close. Overshoot is for entrances; dismissal is instant.
 */

import type { TargetAndTransition } from 'motion/react'

// ---------------------------------------------------------------------------
// Tokens — the shared scale
// ---------------------------------------------------------------------------

/** Per-item stagger offset. */
export const DURATION_STAGGER = 0.04
/** Tooltip / intent delay, shake segment, large stagger. */
export const DURATION_MICRO = 0.08
/** Modal + dropdown close, text swap, tooltip appear. */
export const DURATION_QUICK = 0.15
/** Icon swap, dropdown + modal open, tabs sliding, page slide. */
export const DURATION_FAST = 0.25
/** Panel close, toast close. */
export const DURATION_MEDIUM = 0.35
/** Panel open, skeleton content reveal. */
export const DURATION_SLOW = 0.4
/** Emphasis moments — badge appear, success check. */
export const DURATION_VERY_SLOW = 0.5

/** The default for surface motion: open + close, slide, resize, position change. */
export const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const
/** Icon swap, text swap, text reveal, skeleton reveal. */
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const
/** Tooltip open / close. */
export const EASE_OUT = [0, 0, 0.2, 1] as const
/** Badge pop open. Entrances only — never bounce a close. */
export const EASE_BOUNCE = [0.34, 1.36, 0.64, 1] as const
/** Bouncy hover-out (avatar return) — the one place the out is richer than the in. */
export const EASE_BOUNCE_STRONG = [0.34, 3.85, 0.64, 1] as const

/** Text swap. */
export const DISTANCE_MICRO = 4
/** Error shake, small segment. */
export const DISTANCE_SMALL = 6
/** Modal rise, page slide, error shake large segment. */
export const DISTANCE_BASE = 8
/** Text reveal. */
export const DISTANCE_MEDIUM = 12
/** Check badge appear. Toast travel is its own 16px, not this. */
export const DISTANCE_LARGE = 30
/** Toast rise — the recipe's own distance, slower in than out. */
export const TOAST_DISTANCE = 16

/** Modal open / close. */
export const SCALE_LARGE = 0.96
/** Dropdown open. */
export const SCALE_MEDIUM = 0.97
/** Tooltip open. */
export const SCALE_SMALL = 0.98
/** Dropdown close. */
export const SCALE_TINY = 0.99

/** Panel reveal, icon swap, text swap, skeleton reveal, number pop-in, toast. */
export const BLUR_SMALL = 2
/** Page slide, text reveal. */
export const BLUR_MEDIUM = 3
/** Success check open. */
export const BLUR_LARGE = 8

// ---------------------------------------------------------------------------
// Anchored panel — menu, select, filter, picker, popover, command palette list
// ---------------------------------------------------------------------------

type Side = 'top' | 'bottom' | 'left' | 'right'
type Align = 'start' | 'center' | 'end'

/**
 * The shape every recipe here returns: spread straight onto a `motion` element.
 *
 * Typed loosely on purpose. These objects are handed to `motion/react`, whose own target
 * types are precise enough that a recipe branching between an `x` and a `y` variant stops
 * assigning — and the fix is to keep the branch in one place rather than to widen it at
 * every call site.
 */
export type MotionRecipe = {
  style?: Record<string, string>
  initial: TargetAndTransition
  animate: TargetAndTransition
  exit?: TargetAndTransition
}

/**
 * `transform-origin` for an anchored panel, so it grows out of its trigger.
 * A panel below its trigger grows from its top edge; one flipped above grows from
 * its bottom edge; a submenu to the right grows from its left edge. This is the
 * whole reason a dropdown reads as anchored.
 */
export function dropOrigin(side: Side = 'bottom', align: Align = 'start'): string {
  if (side === 'left' || side === 'right') {
    const x = side === 'left' ? 'right' : 'left'
    const y = align === 'end' ? 'bottom' : align === 'center' ? 'center' : 'top'
    return `${y} ${x}`
  }
  const y = side === 'top' ? 'bottom' : 'top'
  const x = align === 'end' ? 'right' : align === 'center' ? 'center' : 'left'
  return `${y} ${x}`
}

/**
 * The dropdown recipe. Every anchored surface in the app opens with this and nothing else.
 *
 * Scale + opacity only, no travel: a y-offset makes a menu read as a sheet that happens to
 * be near its trigger, and that mismatch is why our menus used to feel subtly different
 * from one another.
 */
export function dropdownMotion(
  reduce: boolean | null,
  { side = 'bottom', align = 'start' }: { side?: Side; align?: Align } = {},
) {
  const style = { transformOrigin: dropOrigin(side, align) }
  if (reduce) {
    return {
      style,
      initial: { opacity: 0, scale: 1 },
      animate: { opacity: 1, scale: 1, transition: { duration: 0 } },
      exit: { opacity: 0, scale: 1, transition: { duration: 0 } },
    }
  }
  return {
    style,
    initial: { opacity: 0, scale: SCALE_MEDIUM },
    animate: {
      opacity: 1,
      scale: 1,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
    exit: {
      opacity: 0,
      scale: SCALE_TINY,
      transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT },
    },
  }
}

// ---------------------------------------------------------------------------
// Modal — centred, so it scales from the middle plus a short rise from below
// ---------------------------------------------------------------------------

export function modalMotion(
  reduce: boolean | null,
  { from = 'below' }: { from?: 'below' | 'above' } = {},
): MotionRecipe {
  const rise = from === 'above' ? -DISTANCE_BASE : DISTANCE_BASE
  if (reduce) {
    return {
      initial: { opacity: 0, y: 0, scale: 1 },
      animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0 } },
      exit: { opacity: 0, y: 0, scale: 1, transition: { duration: 0 } },
    }
  }
  return {
    initial: { opacity: 0, y: rise, scale: SCALE_LARGE },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
    exit: {
      opacity: 0,
      y: rise,
      scale: SCALE_LARGE,
      transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT },
    },
  }
}

// ---------------------------------------------------------------------------
// Sheet — a surface docked to an edge
// ---------------------------------------------------------------------------

/**
 * The one overlay recipe that travels, and it travels its full extent rather than a fixed
 * distance: the surface starts entirely off-screen so it reads as *arriving from* the edge
 * rather than fading in near it. Losing the travel loses the only cue for which edge it
 * came from.
 *
 * Timing is the panel pair (400 in / 350 out), not the modal pair — a sheet crosses most of
 * the viewport and the modal's 250ms over that distance is a lurch.
 */
export function sheetMotion(
  reduce: boolean | null,
  { edge = 'right' }: { edge?: 'top' | 'bottom' | 'left' | 'right' } = {},
): MotionRecipe {
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT } },
      exit: { opacity: 0, transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT } },
    }
  }
  const away = edge === 'top' || edge === 'left' ? '-100%' : '100%'
  const enter = { duration: DURATION_SLOW, ease: EASE_SMOOTH_OUT }
  const leave = { duration: DURATION_MEDIUM, ease: EASE_SMOOTH_OUT }

  /* Written out per axis rather than with a computed key: a `{ [axis]: value }` object types
     as an index signature, which motion's target type will not accept. */
  if (edge === 'left' || edge === 'right') {
    return {
      initial: { x: away },
      animate: { x: 0, transition: enter },
      exit: { x: away, transition: leave },
    }
  }
  return {
    initial: { y: away },
    animate: { y: 0, transition: enter },
    exit: { y: away, transition: leave },
  }
}

/**
 * The scrim under a sheet or modal.
 *
 * Opacity only, and it fades on the close duration in both directions. A scrim leading the
 * panel in would flash a grey screen before anything arrives to justify it.
 */
export function scrimMotion(reduce: boolean | null) {
  const transition = { duration: reduce ? 0 : DURATION_MEDIUM, ease: EASE_SMOOTH_OUT }
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition },
    exit: { opacity: 0, transition },
  }
}

// ---------------------------------------------------------------------------
// Tabs, page swap, column yield
// ---------------------------------------------------------------------------

/**
 * The active-pill `layoutId` slide in a segmented control or a view-tab strip.
 * Symmetric: the pill reads as one reversible motion, so it does not split into a pair.
 */
export function tabsMotion(reduce: boolean | null) {
  return reduce ? { duration: 0 } : { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT }
}

/**
 * A body swapped wholesale under a set of tabs — a record page stepping between Overview
 * and Activity, a settings rail changing panes.
 *
 * Enter-only, and that is the point: cross-fading the outgoing pane means holding two full
 * trees mounted to animate something you have already stopped looking at. The new pane
 * arriving is the whole message.
 */
export function pageMotion(reduce: boolean | null, dir: 1 | -1 = 1) {
  if (reduce) return { initial: false as const }
  return {
    initial: { opacity: 0, x: DISTANCE_BASE * dir },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
  }
}

/**
 * A side column that gives or takes space in a row — the record peek beside a grid.
 * The width *is* the layout change; opacity keeps the contents from popping as the clip
 * opens. Put it on an `overflow-hidden` wrapper whose child is sized to the open width, so
 * the content does not reflow while the column travels.
 */
export function columnMotion(reduce: boolean | null, width: number | string, instant = false) {
  const duration = reduce || instant ? 0 : undefined
  return {
    initial: { width: 0, opacity: 0 },
    animate: {
      width,
      opacity: 1,
      transition: { duration: duration ?? DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
    exit: {
      width: 0,
      opacity: 0,
      transition: { duration: duration ?? DURATION_QUICK, ease: EASE_SMOOTH_OUT },
    },
  }
}

/**
 * A full-width strip that opens or closes in the flow — the selection bar over a grid, an
 * inline filter builder, a warning that appears under a toolbar.
 *
 * The vertical twin of `columnMotion`, and it exists so these stop being written by hand:
 * a strip that pushes the content below it is a layout change, and layout changes take the
 * surface pair (250 in / 150 out) like every other one. Put it on an `overflow-hidden`
 * wrapper so the contents do not reflow while the height travels.
 */
export function stripMotion(reduce: boolean | null) {
  if (reduce) {
    return {
      initial: { height: 0, opacity: 0 },
      animate: { height: 'auto' as const, opacity: 1, transition: { duration: 0 } },
      exit: { height: 0, opacity: 0, transition: { duration: 0 } },
    }
  }
  return {
    initial: { height: 0, opacity: 0 },
    animate: {
      height: 'auto' as const,
      opacity: 1,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
    exit: {
      height: 0,
      opacity: 0,
      transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT },
    },
  }
}

/**
 * A row joining or leaving a list in the flow — a sidebar entry, a settings table
 * row, a filter condition, a file, a stage.
 *
 * Same usage as a strip that yields height, so the same pair: 250 in / 150 out.
 * Dismissal is instant (no bounce, no delay). Not for data-grid rows: those are a
 * surface people scroll all day, and animating them is performing.
 *
 * Put it on an `overflow-hidden` wrapper. `AnimatePresence initial={false}` so the
 * list does not play entrances on first paint.
 */
export function listItemMotion(reduce: boolean | null) {
  return stripMotion(reduce)
}

/* ---- A conversation appearing in the rail -------------------------------- */

/**
 * How long the composing orb holds the row before the title owns it.
 *
 * Long for this scale, and it has to be. This is the one moment the product answers
 * "where did my question go" — the row is being written while the reply streams — and a
 * 250ms flicker in the corner of the eye is not an answer. It is a status, not a
 * transition, so it is timed like one.
 */
export const COMPOSE_HOLD_MS = 1400

/** When the orb hands the row over. Early enough to overlap, late enough to be seen. */
export const COMPOSE_TITLE_MS = 420

/**
 * A conversation row arriving in the rail.
 *
 * Two entrances, because two different things happen. A row that arrives because you just
 * asked something is an event: it drops in from above with a scale, and the eye is meant
 * to follow it. A row that arrives because the list loaded is furniture: it fades up six
 * pixels, staggered, and is meant to be over before you look. Only the second staggers —
 * a stagger on the first would be animating a list of one.
 */
export function chatRowMotion(reduce: boolean | null, composing: boolean, index: number) {
  if (reduce) {
    return {
      initial: false as const,
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, transition: { duration: 0 } },
      transition: { duration: 0 },
    }
  }
  return {
    initial: composing
      ? { opacity: 0, y: -DISTANCE_BASE, scale: SCALE_LARGE }
      : { opacity: 0, y: DISTANCE_SMALL, scale: 1 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: {
      opacity: 0,
      y: -DISTANCE_SMALL,
      scale: SCALE_SMALL,
      transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT },
    },
    transition: {
      duration: composing ? DURATION_MEDIUM : DURATION_FAST,
      ease: EASE_SMOOTH_OUT,
      delay: composing ? 0 : Math.min(index, 10) * DURATION_STAGGER,
      layout: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
  }
}

/**
 * The orb slot opening and closing in front of the title.
 *
 * Animates its own width rather than mounting into a fixed slot, so a row with no orb has
 * no gap where one would go. `gap` is the row's flex gap, cancelled by a negative margin
 * on the way out — without it the row keeps a hole the width of the gap after the orb has
 * gone, and the title slides twice.
 */
export function chatOrbMotion(reduce: boolean | null, size: number, gap: number) {
  if (reduce) {
    return {
      initial: false as const,
      animate: { width: size, marginRight: 0, opacity: 1, scale: 1, filter: 'blur(0px)' },
      exit: { width: 0, marginRight: -gap, opacity: 0, transition: { duration: 0 } },
      transition: { duration: 0 },
    }
  }
  return {
    initial: {
      width: 0,
      marginRight: -gap,
      opacity: 0,
      scale: 0.5,
      filter: `blur(${BLUR_MEDIUM}px)`,
    },
    animate: { width: size, marginRight: 0, opacity: 1, scale: 1, filter: 'blur(0px)' },
    exit: {
      width: 0,
      marginRight: -gap,
      opacity: 0,
      scale: 0.6,
      filter: `blur(${BLUR_SMALL}px)`,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
    transition: { duration: DURATION_MEDIUM, ease: EASE_SMOOTH_OUT },
  }
}

/**
 * The title resolving out of the orb.
 *
 * Slow on purpose — the longest entrance on the scale. It is standing in for work that is
 * still happening somewhere else, and a title that snaps in reads as one that was already
 * known, which is the wrong thing to say about a name being written.
 */
export function chatTitleMotion(reduce: boolean | null, hidden: boolean, animating: boolean) {
  return {
    animate: hidden
      ? { opacity: 0, x: -DISTANCE_SMALL, filter: `blur(${BLUR_MEDIUM}px)` }
      : { opacity: 1, x: 0, filter: 'blur(0px)' },
    transition:
      reduce || !animating
        ? { duration: 0 }
        : { duration: DURATION_VERY_SLOW, ease: EASE_SMOOTH_OUT },
  }
}

/**
 * One title replacing another — the prompt's first words giving way to a real name.
 *
 * Opacity only. The text underneath has changed length and usually changed shape, so
 * anything that moves would be two different strings sliding past each other.
 */
export const chatTitleSwap = { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT }

/**
 * A chip leaving a horizontal strip — a filter chip, a share, an extra field.
 *
 * Dropdown close by usage: a small control dismisses in place with scale + opacity,
 * no travel. Open 250 / close 150.
 */
export function chipMotion(reduce: boolean | null): MotionRecipe {
  if (reduce) {
    return {
      initial: { opacity: 0, scale: 1 },
      animate: { opacity: 1, scale: 1, transition: { duration: 0 } },
      exit: { opacity: 0, scale: 1, transition: { duration: 0 } },
    }
  }
  return {
    initial: { opacity: 0, scale: SCALE_MEDIUM },
    animate: {
      opacity: 1,
      scale: 1,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
    exit: {
      opacity: 0,
      scale: SCALE_TINY,
      transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT },
    },
  }
}

/**
 * Toast — rises from below, slower in than out. Not a dock: a dock is a
 * consequence of a selection and lives over a grid; a toast confirms an
 * outcome and has to be looked at. 350 in / 250 out, 16px, scale 0.97.
 */
export function toastMotion(reduce: boolean | null): MotionRecipe {
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0 } },
      exit: { opacity: 0, transition: { duration: 0 } },
    }
  }
  return {
    initial: {
      opacity: 0,
      y: TOAST_DISTANCE,
      scale: SCALE_MEDIUM,
      filter: `blur(${BLUR_SMALL}px)`,
    },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: 'blur(0px)',
      transition: { duration: DURATION_MEDIUM, ease: EASE_SMOOTH_OUT },
    },
    exit: {
      opacity: 0,
      y: TOAST_DISTANCE,
      scale: SCALE_MEDIUM,
      filter: `blur(${BLUR_SMALL}px)`,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
  }
}

/**
 * Desktop rail collapse. Column-yield by usage: the width *is* the layout
 * change. Open 250 / close 150, a tween, never a spring — a rail must not
 * overshoot the sheet it is yielding to.
 */
export function railMotion(reduce: boolean | null, open: boolean) {
  if (reduce) return { duration: 0 }
  return {
    duration: open ? DURATION_FAST : DURATION_QUICK,
    ease: EASE_SMOOTH_OUT,
  }
}

/**
 * The tree inside the rail, as one surface.
 *
 * Width lives on the aside (`railMotion`). This is the contents arriving in
 * that clip — load, and every open. Same pair as the column (250 in / 150 out),
 * a page-slide's 8px from the rail's own edge, no stagger: a nav people open
 * all day must not perform per row.
 */
export function railContentMotion(reduce: boolean | null, open: boolean): MotionRecipe {
  if (reduce) {
    return {
      initial: { opacity: 0, x: 0 },
      animate: { opacity: 1, x: 0, transition: { duration: 0 } },
    }
  }
  const transition = {
    duration: open ? DURATION_FAST : DURATION_QUICK,
    ease: EASE_SMOOTH_OUT,
  }
  return {
    initial: { opacity: 0, x: -DISTANCE_BASE },
    animate: { opacity: 1, x: 0, transition },
  }
}

/**
 * A bar that floats in over content it does not displace — the selection dock above a grid,
 * an undo toast.
 *
 * Rises from below rather than fading in place. A dock appears because *you* did something
 * off in the rows, and the movement is the only thing that will pull an eye anchored on a
 * checkbox down to a bar 400px away; a cross-fade at the bottom of a busy screen is missed.
 * The travel is `DISTANCE_MEDIUM` and no more, because the bar must not read as a sheet
 * climbing up over the page.
 *
 * Exit is `DURATION_QUICK` and takes the offset with it. Clearing a selection is a dismissal,
 * and dismissals do not linger.
 */
export function dockMotion(reduce: boolean | null) {
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0 } },
      exit: { opacity: 0, transition: { duration: 0 } },
    }
  }
  return {
    initial: { opacity: 0, y: DISTANCE_MEDIUM, scale: SCALE_MEDIUM },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
    },
    exit: {
      opacity: 0,
      y: DISTANCE_MEDIUM,
      scale: SCALE_MEDIUM,
      transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT },
    },
  }
}

// ---------------------------------------------------------------------------
// Chrome shared with the primitives
// ---------------------------------------------------------------------------

/** Nucleo outline stroke used on every control icon (chevrons, segments, cells). */
export const iconStroke = 1.5

/**
 * Shared frosted glass shell for menus — soft float + heavy blur.
 *
 * No border: the edge is the first layer of `--shadow-overlay`. A 1px ring and a 1px
 * border on the same element paint two lines a subpixel apart, which is what makes a panel
 * look slightly furry at 100% zoom and doubles its weight on a retina display.
 */
export const glassMenu = 'bg-surface/90 backdrop-blur-xl shadow-(--shadow-overlay)'

/**
 * Hit feedback is the face and colour change, not a squash. Kept as a no-op so
 * existing `cn(..., pressClass)` call sites stay valid without reintroducing scale.
 */
export const pressClass = ''

/** Control interaction springs — thumb slide, dock lift. Not for overlay surfaces. */
export const springSnappy = { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.6 }
export const springSoft = { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.7 }

// ---------------------------------------------------------------------------
// Usage aliases
//
// Named for what they animate rather than for a number, and every one resolves to a recipe
// above. They exist so the surfaces written before the scale landed keep moving on it.
// ---------------------------------------------------------------------------

/** @deprecated Reach for `EASE_SMOOTH_OUT`. The old name for the same curve. */
export const easeOutQuart = EASE_SMOOTH_OUT
export const pageEase = EASE_SMOOTH_OUT

/** Scrim / lightweight overlay fade. */
export const overlayFade = { duration: DURATION_MEDIUM, ease: EASE_SMOOTH_OUT }
/** Dialog and popover panels — the modal pair, symmetric callers only. */
export const overlayPanel = { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT }
/** Compact menu / tooltip. */
export const overlayMenu = { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT }
/** Drawer scrim tint. */
export const drawerFade = { duration: DURATION_MEDIUM, ease: EASE_SMOOTH_OUT }
/** Drawer panel slide. A tween, not a spring: a sheet must not overshoot its own edge. */
export const drawerSlide = { duration: DURATION_SLOW, ease: EASE_SMOOTH_OUT }

/** Page / section entrance — fade + slight rise. */
export const pageEnter = { duration: DURATION_SLOW, ease: EASE_SMOOTH_OUT }
export const pageExit = { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT }

/**
 * Staggered page blocks (title → actions → body).
 *
 * Total stagger stays under ~300ms so the last block never feels late; for anything longer
 * than a handful of items, drop the stagger rather than shrinking the offset further.
 */
export const pageEnterStagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: DURATION_STAGGER, delayChildren: 0.02 },
  },
}

export const pageEnterItem = {
  hidden: { opacity: 0, y: DISTANCE_BASE },
  show: { opacity: 1, y: 0, transition: pageEnter },
}

/** Call desk — hierarchy stagger inside each half of the split. */
export const callPaneStagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: DURATION_STAGGER, delayChildren: 0.03 },
  },
}

export const callPaneItem = {
  hidden: { opacity: 0, y: DISTANCE_SMALL },
  show: { opacity: 1, y: 0, transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT } },
}

export const callPaneItemLeft = {
  hidden: { opacity: 0, x: -DISTANCE_BASE },
  show: { opacity: 1, x: 0, transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT } },
}

export const callPaneItemRight = {
  hidden: { opacity: 0, x: DISTANCE_BASE },
  show: { opacity: 1, x: 0, transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT } },
}

/** Card swap on the call / inbox desk — enter only, no exit fade (avoids a blank flash). */
export const callCardSwap = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
  transition: { duration: DURATION_QUICK, ease: EASE_SMOOTH_OUT },
}

/** Available-slot chips — stagger in when the offer arrives. */
export const slotStagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: DURATION_STAGGER, delayChildren: DURATION_STAGGER },
  },
}

export const slotItem = {
  hidden: { opacity: 0, y: DISTANCE_BASE, scale: SCALE_MEDIUM },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: DURATION_FAST, ease: EASE_SMOOTH_OUT },
  },
}
