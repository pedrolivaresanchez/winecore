import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { copy } from "@/i18n";
import { entityName, roleLabel } from "@/lib/labels";
import type { EntityCode, Me } from "@/lib/types";

function rolesFor(me: Me, code: EntityCode | null) {
  return [...new Set(me.roles.filter((role) => role.legal_entity_code === code).map((role) => role.role))];
}

export function EntityRoles({ me }: { me: Me }) {
  const groupRoles = rolesFor(me, null);
  if (me.entities.length === 0 && groupRoles.length === 0) {
    return <EmptyState title={copy.panel.noEntities} />;
  }
  return (
    <ul className="grid gap-3">
      {groupRoles.length > 0 ? (
        <li className="rounded-xl border bg-card p-3">
          <h3 className="text-body font-semibold">{copy.entity.all}</h3>
          <p className="mt-0.5 text-meta text-muted-foreground">{copy.panel.group}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {groupRoles.map((role) => (
              <StatusPill key={role}>{roleLabel(role)}</StatusPill>
            ))}
          </div>
        </li>
      ) : null}
      {me.entities.map((entity) => {
        const roles = rolesFor(me, entity.code);
        const label = entityName(entity.code);
        return (
          <li key={entity.id} className="rounded-xl border bg-card p-3">
            <h3 className="text-body font-semibold">{label}</h3>
            {entity.legal_name && entity.legal_name !== label ? (
              <p className="mt-0.5 text-meta break-words text-muted-foreground">{entity.legal_name}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {roles.length > 0 ? (
                roles.map((role) => <StatusPill key={role}>{roleLabel(role)}</StatusPill>)
              ) : (
                <p className="text-compact text-muted-foreground">{copy.panel.noRole}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
