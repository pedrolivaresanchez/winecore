/**
 * Left-click with no modifier — the case an SPA should handle itself.
 *
 * Cmd/Ctrl-click, Shift-click, Alt-click and anything but the primary button belong to
 * the browser: new tab, new window, download. A `button` that calls `navigate` eats all
 * of those; an `<a href>` plus this check is how a list keeps the classical click.
 */
export function isModifiedClick(event: {
  button?: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return (
    (event.button != null && event.button !== 0) ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
}
