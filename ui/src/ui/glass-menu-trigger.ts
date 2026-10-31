/**
 * What a menu's trigger has to say about the menu, decided once for every `GlassMenu`.
 *
 * A control that opens a menu owes assistive tech two facts: that it opens something
 * (`aria-haspopup`) and whether that something is open right now (`aria-expanded`). About half
 * the triggers in the app said so and half did not (UI-QA-02), and the half that did each said
 * it by hand. The menu knows both facts better than any call site, so it states them.
 *
 * It states them on the DOM rather than by cloning the `trigger` element, because the element
 * handed in is often not the control: a `Tooltip` around a button, a `div` a chip sits in, a
 * component that does not forward unknown props. Cloning would put `aria-expanded` on a wrapper
 * and leave the button silent. The two triggers that are not controls at all — an `aria-hidden`
 * span and an empty div used as an anchor — match nothing here, which is right: they have no
 * name to announce state under.
 */

/** The first thing inside the trigger a keyboard can land on. */
export const MENU_TRIGGER_CONTROL =
  'button, [role="button"], a[href], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export type MenuTriggerAria = {
  expanded: string | null
  haspopup: string | null
}

/**
 * The attributes the control should carry, given what it carries already.
 *
 * `aria-expanded` is always the menu's own state — a trigger that binds it itself agrees, and
 * one that disagrees is wrong about its own menu. `aria-haspopup` is only filled in where the
 * call site said nothing: a trigger that announces a `dialog` or a `listbox` knows what is in
 * its panel better than this file does, and "menu" over it would be a downgrade.
 */
export function menuTriggerAria(open: boolean, current: MenuTriggerAria): MenuTriggerAria {
  return {
    expanded: open ? 'true' : 'false',
    haspopup: current.haspopup ?? 'menu',
  }
}

/** Find the control and state the two facts on it. Nothing to find is nothing to say. */
export function announceMenuTrigger(root: Element | null, open: boolean): Element | null {
  const control = root?.querySelector(MENU_TRIGGER_CONTROL) ?? null
  if (!control) return null
  const next = menuTriggerAria(open, {
    expanded: control.getAttribute('aria-expanded'),
    haspopup: control.getAttribute('aria-haspopup'),
  })
  if (control.getAttribute('aria-expanded') !== next.expanded) {
    control.setAttribute('aria-expanded', next.expanded!)
  }
  if (next.haspopup && control.getAttribute('aria-haspopup') !== next.haspopup) {
    control.setAttribute('aria-haspopup', next.haspopup)
  }
  return control
}
