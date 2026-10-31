import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { copy } from '@/i18n'

type ShellContextValue = {
  mobile: boolean
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  settings: boolean
  openSettings: () => void
  closeSettings: () => void
  chromeTitle: string
  setChromeTitle: (title: string) => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

export function ShellProvider({
  mobile,
  sidebarOpen,
  setSidebarOpen,
  settings,
  openSettings,
  closeSettings,
  children,
}: {
  mobile: boolean
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  settings: boolean
  openSettings: () => void
  closeSettings: () => void
  children: ReactNode
}) {
  const [chromeTitle, setChromeTitle] = useState(copy.nav.panel)
  const value: ShellContextValue = {
    mobile,
    sidebarOpen,
    setSidebarOpen,
    settings,
    openSettings,
    closeSettings,
    chromeTitle,
    setChromeTitle,
  }
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShell() {
  const value = useContext(ShellContext)
  if (!value) throw new Error('useShell debe usarse dentro del shell')
  return value
}

/** The name in the mobile bar. Pages set it; settings wins while it is open. */
export function useChromeTitle(title: string) {
  const { setChromeTitle, settings } = useShell()
  const set = useCallback((next: string) => setChromeTitle(next), [setChromeTitle])
  useEffect(() => {
    if (settings) return
    set(title)
    document.title = `${title} · ${copy.appName}`
  }, [set, settings, title])
}
