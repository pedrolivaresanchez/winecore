import { useMemo, useState } from "react";
import { toast } from "sonner";
import { NoPermission } from "@/components/NoPermission";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { roleLabel } from "@/lib/labels";
import type { Me } from "@/lib/types";
import { savePolicy } from "@/pages/aprobaciones/api";
import {
  entityLabel,
  explainError,
  HUMAN_ROLES,
  isSensitiveKind,
  kindLabel,
  rolesLabel,
  validityLabel,
  type ApprovalPolicy,
} from "@/pages/aprobaciones/model";

function isOwner(me: Me): boolean {
  return me.roles.some((role) => role.role === "owner");
}

export function PoliciesPanel({ me }: { me: Me }) {
  const remote = useApi<{ items: ApprovalPolicy[] }>(isOwner(me) ? "/v1/approval-policies" : null);
  const [overrides, setOverrides] = useState<Record<string, ApprovalPolicy>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(
    () => (remote.data?.items ?? []).map((item) => overrides[policyKey(item)] ?? item),
    [overrides, remote.data],
  );
  const current = items.find((item) => policyKey(item) === editing) ?? null;

  if (!isOwner(me)) return <NoPermission />;

  if (remote.loading && !remote.data) {
    return (
      <div aria-busy="true" className="grid gap-2">
        <p className="sr-only">{copy.loading}</p>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (remote.error || !remote.data) {
    return (
      <ErrorState
        title={`${copy.error.load} (${remote.error?.code ?? "WC_ERROR"})`}
        detail={remote.error?.message}
        onRetry={remote.reload}
      />
    );
  }

  async function save(policy: ApprovalPolicy, next: ApprovalPolicy) {
    const roles = next.allowed_roles.filter((role) => role !== "agent" && role !== "mcp_client");
    if (roles.length === 0) {
      setFormError("Elige al menos un aprobador. Un cliente de máquina no puede aprobar.");
      return;
    }
    if (!Number.isInteger(next.min_approvals) || next.min_approvals < 1 || next.min_approvals > 3) {
      setFormError("El mínimo es un entero entre 1 y 3.");
      return;
    }
    if (!Number.isInteger(next.validity_hours) || next.validity_hours < 1 || next.validity_hours > 168) {
      setFormError("La caducidad es entre 1 y 168 horas.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const saved = await savePolicy(policy.kind, {
        allowed_roles: roles,
        min_approvals: next.min_approvals,
        requires_step_up: next.requires_step_up,
        validity_hours: next.validity_hours,
        allow_self_approval: next.allow_self_approval,
      });
      setOverrides((current) => ({ ...current, [policyKey(policy)]: { ...policy, ...saved, allowed_roles: roles } }));
      setEditing(null);
      toast("Política guardada");
    } catch (error: unknown) {
      setFormError(error instanceof ApiError ? explainError(error) : "No se ha podido guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-screen="politicas" className="grid gap-3">
      <p className="text-compact text-muted-foreground">Quién aprueba cada acción, cuántas firmas hacen falta y cuándo caduca.</p>
      {current ? (
        <PolicyForm
          policy={current}
          busy={busy}
          error={formError}
          onCancel={() => {
            setEditing(null);
            setFormError(null);
          }}
          onSave={(next) => void save(current, next)}
        />
      ) : items.length === 0 ? (
        <p className="text-compact text-muted-foreground">No hay políticas.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full table-fixed border-collapse text-compact">
            <caption className="sr-only">Políticas de aprobación</caption>
            <thead>
              <tr className="bg-muted">
                <th className="w-[46%] px-2 py-2 text-left font-medium">Tipo</th>
                <th className="w-[18%] px-2 py-2 text-left font-medium">Mín</th>
                <th className="w-[36%] px-2 py-2 text-left font-medium">Caduca</th>
              </tr>
            </thead>
            <tbody>
              {items.map((policy) => (
                <tr key={policyKey(policy)} className="border-t">
                  <td className="px-2 py-2 align-top">
                    <p className="font-medium break-words">{kindLabel(policy.kind)}</p>
                    <p className="text-meta break-words text-muted-foreground">
                      {entityLabel(policy.legal_entity_code)} · {rolesLabel(policy.allowed_roles)} ·{" "}
                      {policy.allow_self_approval ? "puede autoaprobar" : "sin autoaprobación"}
                      {policy.requires_step_up ? " · con verificación" : " · sin verificación"}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      className="mt-2 min-h-11 md:min-h-8"
                      onClick={() => setEditing(policyKey(policy))}
                    >
                      Editar
                    </Button>
                  </td>
                  <td className="px-2 py-2 align-top tabular-nums">{policy.min_approvals}</td>
                  <td className="px-2 py-2 align-top break-words">{validityLabel(policy.validity_hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function policyKey(policy: ApprovalPolicy): string {
  return `${policy.kind}:${policy.legal_entity_code ?? "all"}`;
}

function PolicyForm({
  policy,
  busy,
  error,
  onCancel,
  onSave,
}: {
  policy: ApprovalPolicy;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (next: ApprovalPolicy) => void;
}) {
  const [roles, setRoles] = useState<string[]>(policy.allowed_roles.filter((role) => role !== "agent" && role !== "mcp_client"));
  const [min, setMin] = useState(String(policy.min_approvals));
  const [hours, setHours] = useState(String(policy.validity_hours));
  const [stepUp, setStepUp] = useState(policy.requires_step_up);
  const [selfApproval, setSelfApproval] = useState(policy.allow_self_approval);

  function toggleRole(role: string) {
    setRoles((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]));
  }

  return (
    <form
      data-screen="politicas-editar"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...policy,
          allowed_roles: roles,
          min_approvals: Number(min),
          validity_hours: Number(hours),
          requires_step_up: stepUp,
          allow_self_approval: selfApproval,
        });
      }}
    >
      <button type="button" className="self-start text-compact text-muted-foreground" onClick={onCancel}>
        ← Lista
      </button>
      <h2 className="text-body font-semibold">{kindLabel(policy.kind)}</h2>
      <fieldset className="grid gap-1">
        <legend className="text-compact font-medium">Aprobadores</legend>
        {HUMAN_ROLES.map((role) => (
          <label key={role} className="flex min-h-11 items-center gap-3 text-compact">
            <input type="checkbox" className="size-4" checked={roles.includes(role)} onChange={() => toggleRole(role)} />
            {roleLabel(role)}
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1.5 text-compact font-medium" htmlFor="min-approvals">
        Mínimo de aprobaciones
        <Input id="min-approvals" inputMode="numeric" value={min} onChange={(event) => setMin(event.target.value)} />
      </label>
      <label className="grid gap-1.5 text-compact font-medium" htmlFor="validity-hours">
        Caducidad en horas
        <Input id="validity-hours" inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} />
      </label>
      <p className="text-meta text-muted-foreground">Entre 1 y 168 horas. El mínimo es 1, 2 o 3.</p>
      <label className="flex min-h-11 items-center gap-3 text-compact">
        <input type="checkbox" className="size-4" checked={stepUp} onChange={(event) => setStepUp(event.target.checked)} />
        Exigir passkey o código
      </label>
      <label className="flex min-h-11 items-center gap-3 text-compact">
        <input type="checkbox" className="size-4" checked={selfApproval} onChange={(event) => setSelfApproval(event.target.checked)} />
        El solicitante puede aprobar
      </label>
      {isSensitiveKind(policy.kind) ? (
        <p className="text-meta text-muted-foreground">
          Los envíos a la AEAT, la Junta, EDI y la certificadora suelen exigir passkey y que quien lo pide no se apruebe.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-compact text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
