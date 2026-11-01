import { useMemo, useState } from "react";
import { NoPermission } from "@/components/NoPermission";
import { copy, fill } from "@/i18n";
import { ApiError } from "@/lib/api";
import { roleLabel } from "@/lib/labels";
import type { Me } from "@/lib/types";
import { useApi } from "@/hooks/use-api";
import { savePolicy } from "@/pages/aprobaciones/api";
import {
  entityLabel,
  explainError,
  HUMAN_ROLES,
  isOwner,
  isSensitiveKind,
  kindLabel,
  rolesLabel,
  validityLabel,
  type ApprovalPolicy,
} from "@/pages/aprobaciones/model";
import { Alert, Button, Checkbox, InfoTip, Input, Skeleton, Switch, useToast } from "@/ui";

export function PoliciesPanel({ me }: { me: Me }) {
  const toast = useToast();
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
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (remote.error || !remote.data) {
    return (
      <div className="grid gap-3">
        <Alert tone="danger">{`${copy.error.load} (${remote.error?.code ?? "WC_ERROR"})`}</Alert>
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={remote.reload}>
          {copy.error.retry}
        </Button>
      </div>
    );
  }

  async function save(policy: ApprovalPolicy, next: ApprovalPolicy) {
    const roles = next.allowed_roles.filter((role) => role !== "agent" && role !== "mcp_client");
    if (roles.length === 0) {
      setFormError(`${copy.approvals.needApprover} ${copy.approvals.machine}`);
      return;
    }
    if (!Number.isInteger(next.min_approvals) || next.min_approvals < 1 || next.min_approvals > 3) {
      setFormError(copy.approvals.minError);
      return;
    }
    if (!Number.isInteger(next.validity_hours) || next.validity_hours < 1 || next.validity_hours > 168) {
      setFormError(copy.approvals.hoursError);
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
      setOverrides((currentOverrides) => ({
        ...currentOverrides,
        [policyKey(policy)]: { ...policy, ...saved, allowed_roles: roles },
      }));
      setEditing(null);
      toast(copy.approvals.saved, { tone: "success" });
    } catch (error: unknown) {
      setFormError(error instanceof ApiError ? explainError(error) : copy.approvals.saveFail);
    } finally {
      setBusy(false);
    }
  }

  if (current) {
    return (
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
    );
  }

  return (
    <div data-screen="politicas">
      <p className="mt-3 text-caption text-text-tertiary">{copy.approvals.stepUpGlobalNote}</p>
      {items.length === 0 ? (
        <p className="mt-4 text-label text-text-secondary">{copy.approvals.policyEmpty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface">
          {items.map((policy) => (
            <li key={policyKey(policy)}>
              <button
                type="button"
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-fill-hover"
                onClick={() => setEditing(policyKey(policy))}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-label font-medium text-ink-900">{kindLabel(policy.kind)}</span>
                  <span className="mt-0.5 block text-caption text-text-tertiary">
                    {entityLabel(policy.legal_entity_code)} · {rolesLabel(policy.allowed_roles)} ·{" "}
                    {policy.allow_self_approval ? copy.approvals.canSelf : copy.approvals.noSelf}
                    {" · "}
                    {policy.requires_step_up ? copy.approvals.withStep : copy.approvals.withoutStep}
                  </span>
                </span>
                <span className="shrink-0 text-right text-caption text-text-secondary">
                  <span className="block tabular-nums">{fill(copy.approvals.minShort, { n: String(policy.min_approvals) })}</span>
                  <span className="mt-0.5 block">{validityLabel(policy.validity_hours)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
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
  const sensitive = isSensitiveKind(policy.kind);

  function toggleRole(role: string) {
    setRoles((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]));
  }

  return (
    <form
      data-screen="politicas-editar"
      className="grid gap-6"
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
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-label font-medium text-ink-900">{kindLabel(policy.kind)}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {copy.approvals.list}
        </Button>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-label font-medium text-ink-900">{copy.approvals.approvers}</legend>
        {HUMAN_ROLES.map((role) => (
          <Checkbox key={role} checked={roles.includes(role)} label={roleLabel(role)} onChange={() => toggleRole(role)} />
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="min-approvals">
          <span className="inline-flex items-center gap-1.5">
            {copy.approvals.minimum}
            <InfoTip label={copy.approvals.minimum}>{copy.approvals.validityHelp}</InfoTip>
          </span>
          <Input id="min-approvals" inputMode="numeric" value={min} onChange={(event) => setMin(event.target.value)} />
        </label>
        <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="validity-hours">
          {copy.approvals.validity}
          <Input id="validity-hours" inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} />
        </label>
      </div>
      <div className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-label text-ink-900">{copy.approvals.stepUp}</span>
          <Switch checked={stepUp} onChange={setStepUp} aria-label={copy.approvals.stepUp} />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-label text-ink-900">
            {copy.approvals.selfApproval}
            {sensitive ? <InfoTip label={copy.approvals.selfApproval}>{copy.approvals.selfHelp}</InfoTip> : null}
          </span>
          <Switch checked={selfApproval} onChange={setSelfApproval} aria-label={copy.approvals.selfApproval} />
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy}>
          {busy ? copy.approvals.saving : copy.approvals.save}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
          {copy.approvals.cancel}
        </Button>
      </div>
    </form>
  );
}
