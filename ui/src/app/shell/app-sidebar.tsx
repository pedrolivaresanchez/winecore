import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, PanelLeft, Search, Settings2 } from '@/ui/icons'
import { GlassMenu, MenuItem, Tooltip, useMenuOpen } from '@/ui'
import { textureSecondary } from '@/ui/button'
import { activeRailId, visibleGroups, type RailGroup, type RailItem } from '@/app/nav'
import { PendingBadge } from '@/pages/aprobaciones/PendingBadge'
import { RailRow } from '@/app/shell/rail-row'
import { railMetrics } from '@/app/shell/rail-metrics'
import { useShell } from '@/app/shell/shell-context'
import { SettingsSidebar, type SettingsArea } from '@/app/shell/settings-view'
import { UserMenu } from '@/app/shell/user-menu'
import { copy, fill } from '@/i18n'
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
        <SettingsSidebar me={me} area={area} onArea={onArea} onBack={onBack} />
        <div className={cn('mt-auto shrink-0 pb-2', railMetrics.pad)}>
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
  const groups = visibleGroups(me)
  const activeId = activeRailId(location.pathname, groups)
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({})

  function go(path: string) {
    navigate(path)
    if (mobile) setSidebarOpen(false)
  }

  const destinations = groups.flatMap((group) => group.items)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex shrink-0 items-center', railMetrics.header, railMetrics.pad, collapsed ? 'justify-center' : 'gap-1')}>
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
                <PanelLeft className={railMetrics.icon} strokeWidth={iconStroke} />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <div className={cn('flex shrink-0 pb-2', railMetrics.pad, collapsed && 'justify-center')}>
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
                <Search className={railMetrics.icon} strokeWidth={iconStroke} />
              </button>
            ) : (
              <button
                type="button"
                onClick={search.toggle}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 text-left text-label text-text-tertiary hover:text-ink-900',
                  railMetrics.search,
                  textureSecondary,
                )}
              >
                <Search className={cn(railMetrics.icon, 'shrink-0')} strokeWidth={iconStroke} />
                <span className="min-w-0 flex-1 truncate">{copy.table.search}</span>
                <kbd className="shrink-0 text-caption text-text-tertiary">{commandChord()}</kbd>
              </button>
            )
          }
        >
          {destinations.map((item) => {
            const Icon = item.icon
            return (
              <MenuItem
                key={item.id}
                icon={<Icon className={railMetrics.icon} strokeWidth={iconStroke} />}
                onClick={() => {
                  search.close()
                  go(item.path)
                }}
              >
                {item.label}
              </MenuItem>
            )
          })}
          <MenuItem
            icon={<Settings2 className={railMetrics.icon} strokeWidth={iconStroke} />}
            onClick={() => {
              search.close()
              openSettings()
            }}
          >
            {copy.nav.settings}
          </MenuItem>
        </GlassMenu>
      </div>

      <nav className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 scrollbar-none', railMetrics.pad, railMetrics.gap, collapsed && 'items-center')}>
        {groups.map((group, index) => (
          <RailSection
            key={group.id}
            group={group}
            first={index === 0}
            collapsed={collapsed}
            activeId={activeId}
            expanded={moreOpen[group.id] ?? group.items.some((item) => item.tier === 'more' && item.id === activeId)}
            onToggle={() =>
              setMoreOpen((current) => {
                const open = current[group.id] ?? group.items.some((item) => item.tier === 'more' && item.id === activeId)
                return { ...current, [group.id]: !open }
              })
            }
            onNavigate={go}
          />
        ))}
      </nav>

      <div className={cn('mt-auto shrink-0 pb-2', railMetrics.pad, collapsed && 'flex justify-center')}>
        <UserMenu me={me} collapsed={collapsed} />
      </div>
    </div>
  )
}

function RailSection({
  group,
  first,
  collapsed,
  activeId,
  expanded,
  onToggle,
  onNavigate,
}: {
  group: RailGroup
  first: boolean
  collapsed: boolean
  activeId: string | null
  expanded: boolean
  onToggle: () => void
  onNavigate: (path: string) => void
}) {
  const primary = group.items.filter((item) => item.tier === 'primary')
  const more = group.items.filter((item) => item.tier === 'more')

  return (
    <div className={cn('flex flex-col', railMetrics.gap, collapsed && 'items-center')}>
      {collapsed ? null : (
        <p className={cn('px-2 pb-0.5 text-caption text-text-tertiary', first ? 'pt-1' : 'pt-3')}>{group.label}</p>
      )}
      {primary.map((item) => (
        <NavButton key={item.id} item={item} active={item.id === activeId} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
      {collapsed || more.length === 0 ? null : (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={fill(copy.nav.moreIn, { group: group.label })}
            onClick={onToggle}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 text-left text-label text-text-tertiary',
              railMetrics.row,
              'hover:bg-sidebar-hover hover:text-ink-900',
            )}
          >
            <ChevronDown
              strokeWidth={iconStroke}
              className={cn('size-3 shrink-0 transition-transform duration-(--duration-fast) ease-(--ease-smooth-out)', expanded ? 'rotate-0' : '-rotate-90')}
            />
            <span className="min-w-0 flex-1 truncate">{copy.nav.more}</span>
          </button>
          {expanded
            ? more.map((item) => (
                <NavButton key={item.id} item={item} active={item.id === activeId} collapsed={false} onNavigate={onNavigate} nested />
              ))
            : null}
        </>
      )}
    </div>
  )
}

function NavButton({
  item,
  active,
  collapsed,
  nested,
  onNavigate,
}: {
  item: RailItem
  active: boolean
  collapsed: boolean
  nested?: boolean
  onNavigate: (path: string) => void
}) {
  const Icon = item.icon
  return (
    <div className={cn(nested && 'pl-4')}>
      <RailRow
        active={active}
        label={item.label}
        collapsed={collapsed}
        glyph={
          <span className="relative inline-flex">
            <Icon className={cn(railMetrics.icon, 'shrink-0', active ? 'text-ink-900' : 'text-icon-muted')} strokeWidth={iconStroke} />
            {collapsed && item.id === 'approvals' ? <PendingBadge size="sm" /> : null}
          </span>
        }
        trailing={!collapsed && item.id === 'approvals' ? <PendingBadge inline /> : undefined}
        onNavigate={() => onNavigate(item.path)}
      />
    </div>
  )
}
