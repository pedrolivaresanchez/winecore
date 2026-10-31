import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, PanelLeft, Search } from '@/ui/icons'
import { Tooltip } from '@/ui'
import { textureSecondary } from '@/ui/button'
import { tagToneClass, type TagTone } from '@/ui/tag-palette'
import { activeRailId, visibleGroups, type RailGroup, type RailItem } from '@/app/nav'
import { PendingBadge } from '@/pages/aprobaciones/PendingBadge'
import { RailRow } from '@/app/shell/rail-row'
import { railMetrics } from '@/app/shell/rail-metrics'
import { useShell } from '@/app/shell/shell-context'
import { commandChord } from '@/app/shell/shortcuts'
import { SettingsSidebar, type SettingsArea } from '@/app/shell/settings-view'
import { UserMenu } from '@/app/shell/user-menu'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import type { Me } from '@/lib/types'

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
  const { setSidebarOpen, openCommand, mobile } = useShell()
  const navigate = useNavigate()
  const location = useLocation()
  const groups = visibleGroups(me)
  const activeId = activeRailId(location.pathname, groups)
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({})

  function go(path: string) {
    navigate(path)
    if (mobile) setSidebarOpen(false)
  }

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
        {collapsed ? (
          <Tooltip label={`${copy.table.search} · ${commandChord()}`}>
            <button
              type="button"
              onClick={openCommand}
              aria-label={copy.command.title}
              aria-keyshortcuts="Meta+K Control+K"
              className={cn(
                'flex size-7 items-center justify-center rounded-md text-text-tertiary hover:text-ink-900',
                textureSecondary,
              )}
            >
              <Search className={railMetrics.icon} strokeWidth={iconStroke} />
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (mobile) setSidebarOpen(false)
              openCommand()
            }}
            aria-label={copy.command.title}
            aria-keyshortcuts="Meta+K Control+K"
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 text-left text-label text-text-tertiary hover:text-ink-900',
              railMetrics.search,
              textureSecondary,
            )}
          >
            <Search className={cn(railMetrics.icon, 'shrink-0')} strokeWidth={iconStroke} />
            <span className="min-w-0 flex-1 truncate">{copy.table.search}</span>
            <kbd className="shrink-0 text-caption text-text-tertiary pointer-coarse:hidden">{commandChord()}</kbd>
          </button>
        )}
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
      {collapsed ? (
        first ? null : <span aria-hidden className={cn(tagToneClass(group.tone), 'tag-dot my-1.5 h-px w-4 rounded-full opacity-60')} />
      ) : (
        <p className={cn('flex items-center gap-1.5 px-2 pb-0.5 text-caption text-text-tertiary', first ? 'pt-1' : 'pt-3')}>
          <span aria-hidden className={cn(tagToneClass(group.tone), 'tag-dot size-1.5 shrink-0 rounded-full')} />
          {group.label}
        </p>
      )}
      {primary.map((item) => (
        <NavButton key={item.id} item={item} tone={group.tone} active={item.id === activeId} collapsed={collapsed} onNavigate={onNavigate} />
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
                <NavButton key={item.id} item={item} tone={group.tone} active={item.id === activeId} collapsed={false} onNavigate={onNavigate} nested />
              ))
            : null}
        </>
      )}
    </div>
  )
}

function NavButton({
  item,
  tone,
  active,
  collapsed,
  nested,
  onNavigate,
}: {
  item: RailItem
  tone: TagTone
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
        tone={tone}
        collapsed={collapsed}
        glyph={
          <span className="relative inline-flex">
            <Icon className={cn(railMetrics.icon, 'shrink-0', active ? 'text-(--tag-fg-0)' : 'text-(--tag-dot-0)')} strokeWidth={iconStroke} />
            {collapsed && item.id === 'approvals' ? <PendingBadge size="sm" /> : null}
          </span>
        }
        trailing={!collapsed && item.id === 'approvals' ? <PendingBadge inline /> : undefined}
        onNavigate={() => onNavigate(item.path)}
      />
    </div>
  )
}
