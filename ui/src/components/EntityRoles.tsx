import { Badge, EmptyState } from '@/ui'
import { copy } from '@/i18n'
import { entityName, roleLabel } from '@/lib/labels'
import type { EntityCode, Me } from '@/lib/types'

function rolesFor(me: Me, code: EntityCode | null) {
  return [...new Set(me.roles.filter((role) => role.legal_entity_code === code).map((role) => role.role))]
}

export function EntityRoles({ me }: { me: Me }) {
  const groupRoles = rolesFor(me, null)
  if (me.entities.length === 0 && groupRoles.length === 0) {
    return <EmptyState size="sm" title={copy.panel.noEntities} />
  }
  return (
    <ul className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-(--shadow-panel)">
      {groupRoles.length > 0 ? (
        <li className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-label font-medium text-ink-900">{copy.entity.all}</h2>
          <p className="mt-0.5 text-caption text-text-tertiary">{copy.panel.group}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {groupRoles.map((role) => (
              <Badge key={role} tone="neutral">
                {roleLabel(role)}
              </Badge>
            ))}
          </div>
        </li>
      ) : null}
      {me.entities.map((entity) => {
        const roles = rolesFor(me, entity.code)
        const label = entityName(entity.code)
        return (
          <li key={entity.id} className="border-b border-border-subtle px-4 py-3 last:border-b-0">
            <h2 className="text-label font-medium text-ink-900">{label}</h2>
            {entity.legal_name && entity.legal_name !== label ? (
              <p className="mt-0.5 text-caption break-words text-text-tertiary">{entity.legal_name}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {roles.length > 0 ? (
                roles.map((role) => (
                  <Badge key={role} tone="info">
                    {roleLabel(role)}
                  </Badge>
                ))
              ) : (
                <p className="text-caption text-text-tertiary">{copy.panel.noRole}</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
