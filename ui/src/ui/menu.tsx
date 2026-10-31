import { forwardRef, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronRight, Search } from './icons'
import { cn } from '../lib/cn'
import { iconStroke, pressClass } from '../lib/motion'

/**
 * The inside of a menu.
 *
 * `GlassMenu` and `Popover` give you a panel; these are the rows that go in it. Split out
 * because the CRM toolbar alone has nine menus — sort, columns, filter, views, lists,
 * aggregations, sharing, row actions, the object switcher — and nine hand-rolled
 * `rounded-md px-2 py-1.5 hover:bg-fill-hover` buttons drift within a week. A menu row is
 * 28px, and its trailing slot is where a checkmark, a count or a submarker goes.
 */

export const MenuItem = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode
    onClick?: () => void
    /** Leading glyph. Reserved even when absent, so labels line up down the menu. */
    icon?: ReactNode
    /** Ticked state for a menu that toggles rather than navigates. */
    checked?: boolean
    /** One of a set rather than a toggle: announced as a radio item, ticked the same way. */
    radio?: boolean
    /** Right-hand hint: a count, a shortcut, a value. */
    trailing?: ReactNode
    /** Marks this row as the current choice — heavier ink, no tick. */
    active?: boolean
    submenu?: boolean
    tone?: 'default' | 'danger'
    disabled?: boolean
    className?: string
  }
>(function MenuItem(
  {
    children,
    onClick,
    icon,
    checked,
    radio,
    trailing,
    active,
    submenu,
    tone = 'default',
    disabled,
    className,
  },
  ref,
) {
  const selectable = checked !== undefined

  return (
    <button
      ref={ref}
      type="button"
      role={selectable ? (radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
      aria-checked={selectable ? checked : undefined}
      onMouseDown={(event) => {
        /* A toggle must not steal the caret from `MenuSearch`. Without this, ticking a
           second catalog badge means typing the next filter term into a closed search. */
        if (selectable) event.preventDefault()
      }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-[6px] px-2 text-left text-label',
        'transition-[color,background-color,transform] duration-(--duration-quick) ease-(--ease-smooth-out)',
        'outline-none focus-visible:bg-fill-hover',
        pressClass,
        tone === 'danger'
          ? 'text-danger-600 hover:bg-danger-50'
          : active
            ? 'font-medium text-ink-900 hover:bg-fill-hover'
            : 'text-control hover:bg-fill-hover hover:text-ink-900',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      {selectable ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {checked ? <Check className="size-3.5 text-ink-900" strokeWidth={2} /> : null}
        </span>
      ) : icon ? (
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center',
            tone !== 'danger' && 'text-icon-muted',
          )}
        >
          {icon}
        </span>
      ) : null}

      <span className="flex min-w-0 flex-1 items-center overflow-hidden">
        {typeof children === 'string' || typeof children === 'number' ? (
          <span className="min-w-0 truncate">{children}</span>
        ) : (
          children
        )}
      </span>

      {trailing ? (
        <span className="shrink-0 whitespace-nowrap text-caption tabular-nums text-text-tertiary">
          {trailing}
        </span>
      ) : null}
      {submenu ? (
        <ChevronRight className="size-3 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
      ) : null}
    </button>
  )
})

/** Section heading inside a menu. Not a row: it is never focusable. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-caption font-medium text-text-secondary">
      {children}
    </div>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border-subtle" />
}

/**
 * Type-to-filter row for a menu long enough to need one — a column list, a catalog, the
 * user directory. Above about a dozen rows scanning stops working and everybody starts
 * typing, so the field is the menu's first element rather than a hidden affordance.
 *
 * Focus is taken on mount, but the panel that hosts this is often still `visibility:
 * hidden` while GlassMenu measures it — HTML `autoFocus` is ignored on a hidden input.
 * GlassMenu focuses again once the panel is on screen; this is the fallback for a
 * search that is not inside that measure-then-show dance.
 */
export function MenuSearch({
  value,
  onChange,
  placeholder,
  autoFocus = true,
  onKeyDown,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  autoFocus?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (!autoFocus) return
    focusFirstMenuField(inputRef.current)
  }, [autoFocus])

  return (
    <div className="-mx-1 -mt-1 mb-1 flex h-9 items-center gap-2 border-b border-border-subtle px-2.5">
      <Search className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        data-menu-skip-focus={autoFocus ? undefined : ''}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-label text-ink-900 outline-none',
          'placeholder:text-text-tertiary',
        )}
      />
    </div>
  )
}

const MENU_FIELD =
  'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="number"], textarea'

/**
 * Put the caret in the first typeable field of a menu.
 *
 * Returns whether it landed. Callers that measure a panel before showing it should retry
 * once the panel is visible — a hidden input will not take focus.
 */
export function focusFirstMenuField(root: ParentNode | HTMLElement | null): boolean {
  if (!root) return false
  const fields =
    root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement
      ? [root]
      : [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(MENU_FIELD)]
  for (const field of fields) {
    if (field.disabled || field.dataset.menuSkipFocus != null) continue
    field.focus({ preventScroll: true })
    return typeof document !== 'undefined' && document.activeElement === field
  }
  return false
}

/** Scroll region for the rows under a `MenuSearch`. */
export function MenuScroll({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        /* `overflow-y-auto` alone computes overflow-x to auto as well, which is how a
           long label grew a horizontal scrollbar instead of ellipsizing. */
        '-mx-1 max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain px-1',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** What a filtered menu shows when nothing matches. */
export function MenuEmpty({ children }: { children: ReactNode }) {
  return <div className="px-2 py-3 text-center text-caption text-text-tertiary">{children}</div>
}

/**
 * One quiet line at the foot of a panel, saying what the panel does.
 *
 * For the controls that are not self-evident from their fields. A sort panel shows two rows
 * and an order, and nothing on it says that the second row only breaks ties within the
 * first — which is the entire concept, and the reason somebody's two-term sort "does not
 * work". A sentence under a rule costs one line and answers it before it is asked.
 *
 * Prose, not a help link. A link is a promise to have written the page it points at.
 */
export function MenuFoot({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <>
      <MenuSeparator />
      <div className="flex items-start gap-1.5 px-2 pt-0.5 pb-1 text-caption text-text-tertiary">
        {icon ? <span className="mt-px flex size-3.5 shrink-0 items-center justify-center">{icon}</span> : null}
        <span className="min-w-0 flex-1 text-balance">{children}</span>
      </div>
    </>
  )
}
