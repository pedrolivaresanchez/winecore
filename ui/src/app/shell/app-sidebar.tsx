import { useLocation, useNavigate } from 'react-router-dom'
import { PanelLeft, Search } from '@/ui/icons'
import { GlassMenu, MenuItem, Tooltip, useMenuOpen } from '@/ui'
import { textureSecondary } from '@/ui/button'
import { EntitySwitcher } from '@/app/EntitySwitcher'
import { footerNav, mainNav, visibleChildren, type NavEntry } from '@/app/nav'
import { RailRow } from '@/app/shell/rail-row'
import { useShell } from '@/app/shell/shell-context'
import { SettingsSidebar, type SettingsArea } from '@/app/shell/settings-view'
import { UserMenu } from '@/app/shell/user-menu'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'

function commandChord() {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return mac ? '⌘K' : 'Ctrl K'
}

export function AppSidebar({
  me,
  collapsed,
  settings,
  area,
  onArea,
  onBack,
}: {
  me: Me
  collapsed: boolean
  settings: boolean
  area: SettingsArea
  onArea: (area: SettingsArea) => void
  onBack: () => void
}) {
  if (settings) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SettingsSidebar area={area} onArea={onArea} onBack={onBack} />
        <div className="mt-auto shrink-0 px-2 pb-2">
          <UserMenu me={me} collapsed={false} />
        </div>
      </div>
    )
  }

  return <WorkspaceRail me={me} collapsed={collapsed} />
}

function WorkspaceRail({ me, collapsed }: { me: Me; collapsed: boolean }) {
  const { setSidebarOpen, openSettings, mobile } = useShell()
  const navigate = useNavigate()
  const location = useLocation()
  const search = useMenuOpen()
  const items = mainNav(me)
  const footer = footerNav(me)

  function go(path: string) {
    navigate(path)
    if (mobile) setSidebarOpen(false)
  }

  function active(entry: NavEntry) {
    if (entry.path) {
      if (entry.end) return location.pathname === entry.path
      return location.pathname === entry.path || location.pathname.startsWith(`${entry.path}/`)
    }
    return visibleChildren(me, entry).some(
      (child) => location.pathname === child.path || location.pathname.startsWith(`${child.path}/`),
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex h-12 shrink-0 items-center px-2', collapsed ? 'justify-center' : 'gap-1')}>
        {collapsed ? (
          <Tooltip label={copy.nav.expand}>
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label={copy.nav.expand}
              className="flex size-7 items-center justify-center rounded-md text-ink-900 hover:bg-sidebar-hover"
            >
              <PanelLeft className="size-4" strokeWidth={iconStroke} />
            </button>
          </Tooltip>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-ink-900 text-caption font-medium text-ink-0">
                W
              </span>
              <span className="min-w-0 truncate text-label font-medium text-ink-900">{copy.appName}</span>
            </span>
            <Tooltip label={copy.nav.collapse}>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label={copy.nav.collapse}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-icon-muted hover:bg-sidebar-hover hover:text-ink-900"
              >
                <PanelLeft className="size-3.5" strokeWidth={iconStroke} />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <div className={cn('flex shrink-0 pb-2 px-2', collapsed && 'justify-center')}>
        <GlassMenu
          open={search.open}
          onOpenChange={search.setOpen}
          placement={collapsed ? 'right-start' : 'bottom-start'}
          className={collapsed ? 'w-7' : 'w-full'}
          panelClassName="min-w-[220px]"
          trigger={
            collapsed ? (
              <button
                type="button"
                onClick={search.toggle}
                aria-label={copy.table.search}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md text-text-tertiary hover:text-ink-900',
                  textureSecondary,
                )}
              >
                <Search className="size-3.5" strokeWidth={iconStroke} />
              </button>
            ) : (
              <button
                type="button"
                onClick={search.toggle}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-label text-text-tertiary hover:text-ink-900',
                  textureSecondary,
                )}
              >
                <Search className="size-3.5 shrink-0" strokeWidth={iconStroke} />
                <span className="min-w-0 flex-1 truncate">{copy.table.search}</span>
                <kbd className="shrink-0 text-caption text-text-tertiary">{commandChord()}</kbd>
              </button>
            )
          }
        >
          {items.map((entry) => {
            const Icon = entry.icon
            return (
              <MenuItem
                key={entry.id}
                icon={<Icon className="size-3.5" strokeWidth={iconStroke} />}
                onClick={() => {
                  search.close()
                  if (entry.path) go(entry.path)
                }}
              >
                {entry.label}
              </MenuItem>
            )
          })}
        </GlassMenu>
      </div>

      {collapsed ? (
        <div className="flex justify-center px-2 pb-2">
          <EntitySwitcher collapsed />
        </div>
      ) : (
        <div className="px-2 pb-2">
          <EntitySwitcher />
        </div>
      )}

      <nav className={cn('flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-3 scrollbar-none', collapsed && 'items-center')}>
        {items.map((entry) => {
          const Icon = entry.icon
          const children = visibleChildren(me, entry)
          return (
            <div key={entry.id} className={cn('flex flex-col gap-px', collapsed && 'items-center')}>
              {entry.path ? (
                <RailRow
                  active={active(entry)}
                  label={entry.label}
                  collapsed={collapsed}
                  glyph={<Icon className="size-3.5 shrink-0" strokeWidth={iconStroke} />}
                  onNavigate={() => go(entry.path ?? '/')}
                />
              ) : null}
              {children.map((child) => (
                <RailRow
                  key={child.id}
                  active={location.pathname === child.path || location.pathname.startsWith(`${child.path}/`)}
                  label={child.label}
                  collapsed={collapsed}
                  glyph={<Icon className="size-3.5 shrink-0" strokeWidth={iconStroke} />}
                  onNavigate={() => go(child.path)}
                />
              ))}
            </div>
          )
        })}
      </nav>

      <div className={cn('mt-auto flex shrink-0 flex-col gap-1 px-2 pb-2', collapsed && 'items-center')}>
        {footer.map((entry) => {
          const Icon = entry.icon
          if (entry.action === 'settings') {
            return (
              <RailRow
                key={entry.id}
                active={false}
                label={entry.label}
                collapsed={collapsed}
                glyph={<Icon className="size-3.5 shrink-0" strokeWidth={iconStroke} />}
                onNavigate={openSettings}
              />
            )
          }
          if (!entry.path) return null
          return (
            <RailRow
              key={entry.id}
              active={active(entry)}
              label={entry.label}
              collapsed={collapsed}
              glyph={<Icon className="size-3.5 shrink-0" strokeWidth={iconStroke} />}
              onNavigate={() => go(entry.path ?? '/')}
            />
          )
        })}
        <UserMenu me={me} collapsed={collapsed} />
      </div>
    </div>
  )
}
