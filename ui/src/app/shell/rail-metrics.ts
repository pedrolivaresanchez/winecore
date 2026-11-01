/**
 * Rail measurements, in one place.
 *
 * The shell reads these instead of scattering 272, 56 and 28 through the layout,
 * so a later spacing pass can retune the rail without rewriting the navigation.
 */
export const RAIL_OPEN = 272
export const RAIL_SHUT = 56

export const railMetrics = {
  header: 'h-12',
  row: 'h-7 max-md:h-11',
  pad: 'px-2',
  icon: 'size-3.5',
  gap: 'gap-px',
  account: 'min-h-7 max-md:min-h-11',
  search: 'h-8 max-md:h-11',
} as const
