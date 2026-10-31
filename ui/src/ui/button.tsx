import {
  createContext,
  forwardRef,
  useContext,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '../lib/cn'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'dangerSoft'
  | 'dangerSolid'
  | 'azure'
  | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'
/**
 * `pill` — the app's CTA shape. A button that stands alone on a page or in a dialog.
 * `square` — workspace chrome: a control in a strip directly above a grid of square cells.
 */
export type ButtonShape = 'pill' | 'square'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  shape?: ButtonShape
  iconOnly?: boolean
  /**
   * The press is in flight. The face and the label stay — this is not disabled, and a
   * button that greys out the moment it is pressed reads as refused — a spinner takes
   * the icon's place, and further presses are ignored until it settles.
   */
  loading?: boolean
}

/**
 * The shape a surface hands to every button inside it.
 *
 * Shape is a property of the surface, not of the button: the CRM is square all the way
 * down — chrome, dialogs opened from it, menus anchored to it — and the SDR product is
 * pills all the way down. Passing `shape` at 125 call sites is how a workspace ends up
 * with six square controls and one pill somebody forgot, so the decision is made once at
 * the root of each product and inherited from there. Context crosses portals, so a dialog
 * or a menu rendered into `document.body` still gets its opener's shape.
 */
const ShapeContext = createContext<ButtonShape>('pill')

export function ButtonShapeProvider({
  value,
  children,
}: {
  value: ButtonShape
  children: ReactNode
}) {
  return <ShapeContext.Provider value={value}>{children}</ShapeContext.Provider>
}

export function useButtonShape(): ButtonShape {
  return useContext(ShapeContext)
}

/**
 * Focus is an outline, not a shadow: every face below carries its rim light in
 * `box-shadow`, and a focus shadow would have to replace it. The outline sits 2px off the
 * face in `focus-ring` — 3:1 against paper and sheet alike — and leaves the face alone.
 */
const base =
  'inline-flex items-center justify-center gap-1.5 font-medium select-none whitespace-nowrap ' +
  'transition-[background-image,background-color,border-color,box-shadow,color] duration-(--duration-quick) ease-(--ease-smooth-out) ' +
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring ' +
  'disabled:pointer-events-none disabled:opacity-45'

/** Loading keeps the face at full strength and swaps the icon for the spinner. */
const loadingClass = 'disabled:opacity-100 [&>svg:not([data-spinner])]:hidden'

/**
 * Charcoal face with internal top-light gradient + inset highlight rim.
 * Exported so round chrome (composer +, mic, send) shares the exact recipe.
 */
export const texturePrimary =
  'border border-(--btn-primary-border) ' +
  '[background-image:var(--btn-primary-face)] ' +
  'text-ink-0 shadow-(--shadow-btn-primary) ' +
  'hover:[background-image:var(--btn-primary-face-hover)] ' +
  'active:[background-image:var(--btn-primary-face-active)]'

/**
 * The white face at rest: gradient, light rim, whisper drop, and nothing else.
 *
 * Split out from `textureSecondary` for chrome that wears the face without being pressable
 * — a chip that only displays what a view is sorted by, a field wrapper whose interaction
 * belongs to the input inside it. A surface that lights up under the pointer and then does
 * nothing is a promise the interface does not keep.
 */
export const textureSecondaryFace =
  'border border-(--btn-secondary-border) ' +
  '[background-image:var(--btn-secondary-face)] ' +
  'shadow-(--shadow-btn-secondary)'

/** The same face, plus the hover and pressed states. What a real control wears. */
export const textureSecondaryHover =
  'hover:[background-image:var(--btn-secondary-face-hover)] hover:border-border-strong ' +
  'active:[background-image:var(--btn-secondary-face-active)]'

/**
 * White face — inverse of primary: same top-light gradient stops, light rim, whisper drop.
 * Shared by secondary, danger, dangerSoft, and paired field chrome.
 */
export const textureSecondary = cn(textureSecondaryFace, textureSecondaryHover)

/**
 * Azure face — same inset-top recipe as primary, for bookable slot CTAs and mail send.
 */
export const textureAzure =
  'border border-(--btn-azure-border) ' +
  '[background-image:var(--btn-azure-face)] ' +
  'text-[color:var(--btn-azure-fg)] shadow-(--shadow-btn-azure) ' +
  'hover:[background-image:var(--btn-azure-face-hover)] ' +
  'active:[background-image:var(--btn-azure-face-active)]'

/**
 * Green face — a call you can place because a person is on the record.
 *
 * Same inset-top recipe as azure, darker green so the light icon and label
 * stay readable. A pale tint on the secondary face was not green enough.
 */
export const textureSuccess =
  'border border-(--btn-success-border) ' +
  '[background-image:var(--btn-success-face)] ' +
  'text-[color:var(--btn-success-fg)] shadow-(--shadow-btn-success) ' +
  'hover:[background-image:var(--btn-success-face-hover)] ' +
  'active:[background-image:var(--btn-success-face-active)]'

/**
 * Red face — the one button that ends a call. Same inset-top recipe as success, so the
 * dock's Colgar reads as Aircall's own hangup does: filled red, white type. Not for
 * destructive confirms, which keep the white face and red label of `danger`.
 */
export const textureDanger =
  'border border-(--btn-danger-border) ' +
  '[background-image:var(--btn-danger-face)] ' +
  'text-[color:var(--btn-danger-fg)] shadow-(--shadow-btn-danger) ' +
  'hover:[background-image:var(--btn-danger-face-hover)] ' +
  'active:[background-image:var(--btn-danger-face-active)]'

const variants: Record<ButtonVariant, string> = {
  primary: texturePrimary,
  secondary: cn(textureSecondary, 'text-ink-900'),
  ghost:
    'bg-transparent text-control border border-transparent hover:bg-fill-hover hover:text-ink-700 active:bg-fill-selected',
  /** White gradient face, danger label — Disconnect, Delete, destructive confirm. */
  danger: cn(textureSecondary, 'text-danger-600 hover:text-danger-700'),
  /** Same chrome as danger — Cancel Plan and soft destructive actions. */
  dangerSoft: cn(textureSecondary, 'text-danger-600 hover:text-danger-700'),
  /** Red face, white type — hanging up. */
  dangerSolid: textureDanger,
  /** Blue face — slots and sending mail. */
  azure: textureAzure,
  /** Green face — a reachable contact on the record. */
  success: textureSuccess,
}

/**
 * Compact heights: 28 / 32 / 36 — the reference row sits at md (32px). Height never
 * changes with shape, so a squared toolbar and a pill dialog still line up on the grid.
 */
const sizes: Record<ButtonShape, Record<ButtonSize, string>> = {
  pill: {
    sm: 'h-7 rounded-full px-3 text-label [&_svg]:size-3.5',
    md: 'h-8 rounded-full px-3.5 text-body [&_svg]:size-3.5',
    lg: 'h-9 rounded-full px-4 text-body [&_svg]:size-4',
  },
  /**
   * Paired radii on the Input scale (7 / 8 / 10), so a button, a field and a select sitting
   * in the same toolbar share one corner. Tighter horizontal padding than the pill: a pill
   * needs the extra to keep its label off the curve, a rectangle does not, and in a strip
   * carrying eight controls those pixels are the difference between a toolbar and a queue.
   */
  square: {
    sm: 'h-7 rounded-[7px] px-2.5 text-label [&_svg]:size-3.5',
    md: 'h-8 rounded-md px-3 text-body [&_svg]:size-3.5',
    lg: 'h-9 rounded-lg px-3.5 text-body [&_svg]:size-4',
  },
}

const iconOnlySizes: Record<ButtonSize, string> = {
  sm: 'w-7 px-0',
  md: 'w-8 px-0',
  lg: 'w-9 px-0',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'secondary', size = 'md', shape, iconOnly = false, loading = false, disabled, className, children, ...props },
    ref,
  ) => {
    const inherited = useButtonShape()
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading ? '' : undefined}
        className={cn(
          base,
          variants[variant],
          sizes[shape ?? inherited][size],
          iconOnly && iconOnlySizes[size],
          loading && loadingClass,
          className,
        )}
        {...props}
      >
        {loading ? <ButtonSpinner /> : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

/**
 * A quarter arc over a faint track, in the label's own colour. It arrives on the icon-swap
 * recipe and turns on the linear ease; under reduced motion it holds still.
 */
export function ButtonSpinner({ className }: { className?: string }) {
  return (
    <svg
      data-spinner=""
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn('shrink-0 animate-spinner motion-reduce:animate-none', className)}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5} />
      <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}
