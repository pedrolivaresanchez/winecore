import { motion, type Transition } from 'motion/react'

/**
 * Modal/drawer backdrop.
 *
 * Tint only — no blur. Blur was what hid the record behind the dialog; the wash is
 * `--color-scrim` so dark mode dims with black rather than a pale inverted ink, at a
 * density that still leaves the page readable. Expects a parent `motion` tree with
 * `open` / `closed` variants.
 */
export function OverlayScrim({
  onClick,
  transition,
  label,
}: {
  onClick?: () => void
  transition: Transition
  /** Accessible name — renders a button (e.g. mobile drawer dismiss). */
  label?: string
}) {
  const tint = (
    <motion.div
      variants={{
        open: { opacity: 1 },
        closed: { opacity: 0 },
      }}
      transition={transition}
      className="pointer-events-none absolute inset-0 bg-scrim"
    />
  )

  if (label) {
    return (
      <motion.button type="button" aria-label={label} className="absolute inset-0" onClick={onClick}>
        {tint}
      </motion.button>
    )
  }

  return (
    <motion.div aria-hidden className="absolute inset-0" onClick={onClick}>
      {tint}
    </motion.div>
  )
}
