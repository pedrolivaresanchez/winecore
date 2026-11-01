import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { copy } from '@/i18n'

type KeyLabel = keyof typeof copy.command.keys

/** `g` then a letter. Letters follow the Spanish label where they can, so they read back. */
export const GO_KEYS: { key: string; path: string; label: KeyLabel }[] = [
  { key: 'p', path: '/', label: 'goPanel' },
  { key: 'c', path: '/contactos', label: 'goContacts' },
  { key: 'v', path: '/ventas', label: 'goSales' },
  { key: 'f', path: '/facturas', label: 'goInvoices' },
  { key: 'o', path: '/cobros', label: 'goCollections' },
  { key: 'd', path: '/bodega/depositos', label: 'goCellar' },
  { key: 'e', path: '/stock', label: 'goStock' },
  { key: 'g', path: '/gastos', label: 'goExpenses' },
  { key: 'i', path: '/informes', label: 'goReports' },
]

const CHORD_WINDOW_MS = 1200

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

export function commandChord(): string {
  return isMac() ? '⌘K' : 'Ctrl K'
}

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') != null
}

function overlayOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]') != null
}

/** The page's own search box, if it has one on screen. */
function pageSearch(): HTMLInputElement | null {
  const fields = document.querySelectorAll<HTMLInputElement>('#contenido input[type="search"]')
  for (const field of fields) {
    if (field.disabled || field.offsetParent === null) continue
    return field
  }
  return null
}

/**
 * Keys that work on every screen. Cmd/Ctrl-K is honoured even inside a field, because that
 * is where you are when you want to leave; the single letters are not, or typing a name
 * containing a `g` would navigate away from the form.
 */
export function useGlobalShortcuts({
  onCommand,
  onHelp,
  onToggleRail,
}: {
  onCommand: () => void
  onHelp: () => void
  onToggleRail: () => void
}) {
  const navigate = useNavigate()
  const pendingGo = useRef(0)
  const handlers = useRef({ onCommand, onHelp, onToggleRail, navigate })
  handlers.current = { onCommand, onHelp, onToggleRail, navigate }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const { onCommand, onHelp, onToggleRail, navigate } = handlers.current
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onCommand()
        return
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (typingIn(event.target) || overlayOpen()) return

      if (pendingGo.current > Date.now()) {
        pendingGo.current = 0
        const hit = GO_KEYS.find((entry) => entry.key === event.key.toLowerCase())
        if (hit) {
          event.preventDefault()
          navigate(hit.path)
        }
        return
      }

      switch (event.key) {
        case 'g':
          pendingGo.current = Date.now() + CHORD_WINDOW_MS
          return
        case '/': {
          event.preventDefault()
          const field = pageSearch()
          if (field) {
            field.focus()
            field.select()
          } else {
            onCommand()
          }
          return
        }
        case '?':
          event.preventDefault()
          onHelp()
          return
        case '[':
          event.preventDefault()
          onToggleRail()
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
