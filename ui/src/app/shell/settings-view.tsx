import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Building, Search, Sliders } from '@/ui/icons'
import { Input } from '@/ui'
import { EntityRoles } from '@/components/EntityRoles'
import { SystemStatus } from '@/components/SystemStatus'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke, pressClass } from '@/lib/motion'
import { useShell } from '@/app/shell/shell-context'
import type { Me } from '@/lib/types'

export type SettingsArea = 'entities' | 'system'

const AREAS: { id: SettingsArea; title: string; hint: string; keywords: string }[] = [
  {
    id: 'entities',
    title: copy.settings.entities,
    hint: copy.settings.entitiesHint,
    keywords: 'entidades usuarios roles bodega',
  },
  {
    id: 'system',
    title: copy.settings.system,
    hint: copy.settings.systemHint,
    keywords: 'sistema version esquema base datos escritor',
  },
]

export function settingsAreas(query: string) {
  const needle = query.trim().toLocaleLowerCase('es')
  if (!needle) return AREAS
  return AREAS.filter((area) => `${area.title} ${area.hint} ${area.keywords}`.toLocaleLowerCase('es').includes(needle))
}

export function SettingsSidebar({
  area,
  onArea,
  onBack,
}: {
  area: SettingsArea
  onArea: (area: SettingsArea) => void
  onBack: () => void
}) {
  const { mobile, setSidebarOpen } = useShell()
  const [query, setQuery] = useState('')
  const areas = useMemo(() => settingsAreas(query), [query])

  function choose(next: SettingsArea) {
    onArea(next)
    if (mobile) setSidebarOpen(false)
  }

  return (
    <>
      <div className="flex h-12 shrink-0 items-center px-2">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-label font-medium text-ink-900',
            'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out)',
            'hover:bg-sidebar-hover',
            pressClass,
          )}
        >
          <ArrowLeft className="size-3.5 shrink-0 text-icon-muted" strokeWidth={iconStroke} />
          <span className="min-w-0 truncate">{copy.settings.title}</span>
        </button>
      </div>
      <div className="flex shrink-0 px-2 pb-2">
        <Input
          type="search"
          size="sm"
          className="w-full min-w-0"
          prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.settings.search}
          aria-label={copy.settings.search}
        />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3 scrollbar-none">
        {areas.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-text-tertiary">{copy.settings.empty}</p>
        ) : (
          areas.map((item) => {
            const Icon = item.id === 'entities' ? Building : Sliders
            const active = item.id === area
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => choose(item.id)}
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-label',
                  'transition-[color,background-color] duration-(--duration-quick) ease-(--ease-smooth-out)',
                  active ? 'bg-sidebar-selected font-medium text-ink-900' : 'text-control hover:bg-sidebar-hover',
                )}
              >
                <Icon className="size-3.5 shrink-0" strokeWidth={iconStroke} />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </button>
            )
          })
        )}
      </nav>
    </>
  )
}

export function SettingsView({ me, area }: { me: Me; area: SettingsArea }) {
  const { setChromeTitle } = useShell()
  const current = AREAS.find((item) => item.id === area) ?? AREAS[0]

  useEffect(() => {
    setChromeTitle(copy.settings.title)
    document.title = `${copy.settings.title} · ${copy.appName}`
  }, [setChromeTitle])

  return (
    <div data-screen="ajustes" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-heading font-medium tracking-tight text-ink-900">{current?.title}</h1>
            <p className="mt-1 text-label text-text-secondary">{current?.hint}</p>
          </div>
        </header>
        {area === 'entities' ? <EntityRoles me={me} /> : <SystemStatus />}
      </div>
    </div>
  )
}
