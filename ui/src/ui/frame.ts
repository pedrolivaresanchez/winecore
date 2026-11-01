/** Shared left edge for workspace strips and the grid's pinned column. */
export const FRAME_GUTTER = 'px-3 sm:px-4'

export const FRAME_STRIP_SCROLL =
  'scrollbar-none flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden'

/**
 * The 44px strip over a list. `FilterBar` and `SelectionBar` share it to the pixel: ticking
 * a row swaps one for the other in place, and a bar that changed height would move the row
 * under the pointer at the moment somebody reaches for the next checkbox.
 */
export const LIST_BAR = `flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle ${FRAME_GUTTER}`
