import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { MessageCircle, PanelLeft, Search } from '@/ui/icons'
import { Tooltip } from '@/ui'
import { AppSidebar } from '@/app/shell/app-sidebar'
import { AssistantProvider, openAssistant, toggleAssistant } from '@/app/shell/assistant-context'
import { AssistantDock } from '@/app/shell/assistant-dock'
import { CommandPalette } from '@/app/shell/command-palette'
import { ShellProvider, useShell } from '@/app/shell/shell-context'
import { useGlobalShortcuts } from '@/app/shell/shortcuts'
import { ShortcutsDialog } from '@/app/shell/shortcuts-dialog'
import { SettingsView, type SettingsArea } from '@/app/shell/settings-view'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { DURATION_FAST, iconStroke, overlayFade, railMotion } from '@/lib/motion'
import { RAIL_OPEN, RAIL_SHUT } from '@/app/shell/rail-metrics'
import { readStorage, SIDEBAR_KEY, writeStorage } from '@/lib/storage'
import { useMinWidth } from '@/hooks/use-media'
import type { Me } from '@/lib/types'

const OPEN_W = RAIL_OPEN
const SHUT_W = RAIL_SHUT

/** The stored choice is the desktop rail's. On a phone the rail is a drawer over the page,
    so it always starts shut — opening the app should show the app. */
function readOpen() {
  if (typeof window === 'undefined') return false
  if (window.innerWidth < 768) return false
  const raw = readStorage(SIDEBAR_KEY)
  if (raw === 'collapsed' || raw === 'false') return false
  if (raw === 'expanded' || raw === 'true') return true
  return window.innerWidth >= 1280
}

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const mobile = !useMinWidth(768)
  const wide = useMinWidth(1280)
  const [open, setOpen] = useState(readOpen)
  const [command, setCommand] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [settings, setSettings] = useState(false)
  const [area, setArea] = useState<SettingsArea>('entities')
  const before = useRef<boolean | null>(null)
  const openRef = useRef(open)
  const settingsRef = useRef(settings)
  const mobileRef = useRef(mobile)
  openRef.current = open
  settingsRef.current = settings
  mobileRef.current = mobile

  useEffect(() => {
    function onFocus(event: Event) {
      const detail = (event as CustomEvent<string>).detail
      if (detail !== 'security' && detail !== 'approvals') return
      if (!settingsRef.current) before.current = openRef.current
      setSettings(true)
      setArea(detail === 'approvals' ? 'policies' : 'security')
      setOpen(!mobileRef.current)
    }
    window.addEventListener('winecore-settings', onFocus)
    return () => window.removeEventListener('winecore-settings', onFocus)
  }, [])

  useEffect(() => {
    if (mobile) setOpen(false)
    else if (readStorage(SIDEBAR_KEY) == null) setOpen(wide)
  }, [mobile, wide])

  function setSidebarOpen(next: boolean) {
    setOpen(next)
    if (!mobile) writeStorage(SIDEBAR_KEY, next ? 'expanded' : 'collapsed')
  }

  const openCommand = useCallback(() => setCommand(true), [])
  const toggleRail = () => setSidebarOpen(!openRef.current)

  useGlobalShortcuts({
    onCommand: () => setCommand((current) => !current),
    onHelp: () => setShortcuts(true),
    onToggleRail: toggleRail,
    onAssistant: toggleAssistant,
  })

  function openSettings() {
    if (!settings) before.current = open
    setSettings(true)
    setArea('entities')
    setOpen(!mobile)
  }

  function closeSettings() {
    setSettings(false)
    if (before.current != null) setSidebarOpen(before.current)
  }

  return (
    <ShellProvider
      mobile={mobile}
      sidebarOpen={open}
      setSidebarOpen={setSidebarOpen}
      settings={settings}
      openSettings={openSettings}
      closeSettings={closeSettings}
      openCommand={openCommand}
    >
      <AssistantProvider me={me}>
        <Frame me={me} area={area} onArea={setArea}>
          {children}
        </Frame>
        <CommandPalette
          me={me}
          open={command}
          onClose={() => setCommand(false)}
          onToggleRail={toggleRail}
          onSettings={openSettings}
          onShortcuts={() => setShortcuts(true)}
        />
        <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
        <AssistantDock me={me} />
      </AssistantProvider>
    </ShellProvider>
  )
}

function Frame({
  me,
  area,
  onArea,
  children,
}: {
  me: Me
  area: SettingsArea
  onArea: (area: SettingsArea) => void
  children: ReactNode
}) {
  const { mobile, sidebarOpen, setSidebarOpen, settings, closeSettings, chromeTitle, openCommand } = useShell()
  const reduce = useReducedMotion()
  const railW = mobile ? 0 : sidebarOpen || settings ? OPEN_W : SHUT_W
  const tween = reduce ? { duration: 0 } : railMotion(reduce, sidebarOpen || settings)
  const { pathname } = useLocation()
  const pageRef = useRef<HTMLDivElement>(null)
  const section = pathname.split('/')[1] ?? ''
  const lastSection = useRef(section)

  /* A short fade when you change section, so the jump reads as a page turning rather than a
     flash. Opacity only and never a remount: a transform would re-anchor fixed children,
     and a keyed wrapper would throw away list state on every navigation. Moving inside a
     section (list to record, tab to tab) stays instant. */
  useEffect(() => {
    if (lastSection.current === section) return
    lastSection.current = section
    if (reduce) return
    pageRef.current?.animate([{ opacity: 0.35 }, { opacity: 1 }], {
      duration: DURATION_FAST * 1000,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    })
  }, [section, reduce])

  return (
    <div className="relative h-dvh overflow-hidden bg-sidebar text-text">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        {copy.skip}
      </a>

      {mobile && sidebarOpen ? (
        <motion.button
          type="button"
          aria-label={copy.nav.collapse}
          className="absolute inset-0 bg-scrim"
          style={{ zIndex: 'var(--z-overlay-backdrop)' }}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : overlayFade}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <motion.div
        className="absolute inset-y-0 right-0 flex flex-col overflow-hidden border-l border-border-subtle bg-surface"
        style={{ zIndex: 'var(--z-sticky)' }}
        initial={false}
        animate={{ left: railW }}
        transition={tween}
      >
        {mobile ? (
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 pt-[env(safe-area-inset-top)]">
            <Tooltip label={copy.nav.expand}>
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label={copy.nav.expand}
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-900 hover:bg-fill-hover"
              >
                <PanelLeft className="size-4" strokeWidth={iconStroke} />
              </button>
            </Tooltip>
            <span className="min-w-0 flex-1 truncate text-label font-medium text-ink-900">{chromeTitle}</span>
            <button
              type="button"
              onClick={openAssistant}
              aria-label={copy.assistant.ask}
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-900 hover:bg-fill-hover"
            >
              <MessageCircle className="size-4" strokeWidth={iconStroke} />
            </button>
            <button
              type="button"
              onClick={openCommand}
              aria-label={copy.command.title}
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-ink-900 hover:bg-fill-hover"
            >
              <Search className="size-4" strokeWidth={iconStroke} />
            </button>
          </div>
        ) : null}
        <div id="contenido" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div ref={pageRef} className={cn('min-h-0 min-w-0 flex-1 flex-col overflow-hidden', settings ? 'hidden' : 'flex')}>
            {children}
          </div>
          {settings ? <SettingsView me={me} area={area} /> : null}
        </div>
      </motion.div>

      {mobile ? (
        sidebarOpen ? (
          <aside
            data-screen="rail"
            className="absolute inset-y-0 left-0 flex w-[min(80vw,272px)] flex-col bg-sidebar pt-[env(safe-area-inset-top)]"
            style={{ zIndex: 'var(--z-modal)' }}
          >
            <AppSidebar
              me={me}
              collapsed={false}
              settings={settings}
              area={area}
              onArea={onArea}
              onBack={closeSettings}
            />
          </aside>
        ) : null
      ) : (
        <motion.aside
          className="absolute inset-y-0 left-0 overflow-hidden bg-sidebar"
          style={{ zIndex: 'var(--z-sticky)' }}
          initial={false}
          animate={{ width: railW }}
          transition={tween}
        >
          <div className="flex h-full flex-col" style={{ width: sidebarOpen || settings ? OPEN_W : SHUT_W }}>
            <AppSidebar
              me={me}
              collapsed={!sidebarOpen && !settings}
              settings={settings}
              area={area}
              onArea={onArea}
              onBack={closeSettings}
            />
          </div>
        </motion.aside>
      )}
    </div>
  )
}
