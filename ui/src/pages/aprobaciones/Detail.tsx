import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";
import { decideApproval } from "@/pages/aprobaciones/api";
import { notifyApprovalsChanged } from "@/pages/aprobaciones/events";
import { RejectDialog } from "@/pages/aprobaciones/RejectDialog";
import { StepUpDialog } from "@/pages/aprobaciones/StepUpDialog";
import {
  closedNote,
  entityLabel,
  explainError,
  expiryLabel,
  kindLabel,
  noteProblem,
  quorumLabel,
  shortHash,
  statusMeta,
  type ApprovalDetail as ApprovalRecord,
} from "@/pages/aprobaciones/model";

type PendingAction = { decision: "approve" | "reject"; note?: string };

export function ApprovalDetail({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const approval = useApi<ApprovalRecord>(id ? `/v1/approvals/${encodeURIComponent(id)}` : null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [stepUp, setStepUp] = useState<PendingAction | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(action: PendingAction, afterStepUp = false) {
    if (!approval.data) return;
    setBusy(true);
    setBanner(null);
    try {
      await decideApproval(approval.data.id, {
        decision: action.decision,
        payload_sha256: approval.data.payload_sha256,
        note: action.note,
      });
      toast(action.decision === "approve" ? "Aprobado. Se ejecutará en unos minutos." : "Rechazado. Se ha avisado a quien lo pidió.");
      setStepUp(null);
      setRejectOpen(false);
      setNote("");
      notifyApprovalsChanged();
      approval.reload();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "WC_STEP_UP_REQUIRED" && !afterStepUp) {
        setRejectOpen(false);
        setStepUp(action);
        return;
      }
      const message = error instanceof ApiError ? explainError(error) : "No se ha podido registrar la decisión.";
      setBanner(message);
      setStepUp(null);
    } finally {
      setBusy(false);
    }
  }

  if (approval.loading && !approval.data) {
    return (
      <div data-screen="aprobacion-cargando" aria-busy="true" className="grid gap-3">
        <p className="sr-only">{copy.loading}</p>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (approval.error || !approval.data) {
    return (
      <ErrorState
        title={`${copy.error.load} (${approval.error?.code ?? "WC_ERROR"})`}
        detail={approval.error?.message}
        onRetry={approval.reload}
      />
    );
  }

  const record = approval.data;
  const status = statusMeta(record.status);
  const expiry = expiryLabel(record.expires_at, record.status, Date.now());
  const canAct = record.status === "pending" && record.can_decide;
  const phrase = "Vas a aprobar exactamente lo que ves.";

  return (
    <div data-screen="aprobacion" data-status={record.status} className={cn("flex flex-col gap-4", canAct && "pb-40 md:pb-0")}>
      <Link to="/aprobaciones" className="text-compact text-muted-foreground">
        ← Aprobaciones
      </Link>
      <PageHeader
        title={record.title}
        description={`${kindLabel(record.kind)} · ${entityLabel(record.legal_entity_code)}`}
        actions={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      />
      {banner ? (
        <p role="alert" data-screen="decision-error" className="rounded-xl bg-status-danger px-3 py-3 text-compact text-status-danger-fg">
          {banner}
        </p>
      ) : null}
      {!canAct && record.reason_cannot_decide ? (
        <p className="rounded-xl bg-muted px-3 py-3 text-compact">{record.reason_cannot_decide}</p>
      ) : null}
      {closedNote(record.status) ? <p className="text-compact text-muted-foreground">{closedNote(record.status)}</p> : null}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="grid gap-3">
          <div className="rounded-xl border bg-card px-3 py-3">
            <p className="text-meta text-muted-foreground">Hash del contenido</p>
            <p className="mt-1 font-mono text-body font-medium tracking-wide">{shortHash(record.payload_sha256)}</p>
            <p className="mt-1 font-mono text-meta break-all text-muted-foreground">{record.payload_sha256}</p>
            <p className="mt-2 text-meta text-muted-foreground">Tiene que coincidir con lo que se va a ejecutar.</p>
          </div>
          <h2 className="text-body font-semibold">Qué se va a ejecutar</h2>
          <dl className="divide-y rounded-xl border bg-card">
            {record.payload_display.map((row) => (
              <div key={row.label} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-3">
                <dt className="text-meta text-muted-foreground">{row.label}</dt>
                <dd className="text-compact break-words whitespace-pre-wrap">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <aside className="grid gap-4">
          {canAct ? (
            <div className="max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:z-30 max-md:border-t max-md:bg-background max-md:px-3 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <p className="mb-2 text-center text-compact font-medium md:text-left">
                <span className="hidden md:inline">Firmas como {me.display_name}. </span>
                {phrase}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="danger" className="h-12" disabled={busy || Boolean(stepUp)} onClick={() => setRejectOpen(true)}>
                  Rechazar
                </Button>
                <Button type="button" className="h-12" disabled={busy || Boolean(stepUp)} onClick={() => void submit({ decision: "approve" })}>
                  <KeyRound aria-hidden />
                  {busy && !rejectOpen ? "Enviando…" : "Aprobar"}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border bg-card px-3 py-3">
            <p className="text-meta text-muted-foreground">Aprobaciones</p>
            <p className="mt-1 text-title font-semibold tabular-nums">{quorumLabel(record.approvals_count, record.min_approvals)}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full bg-ink"
                style={{ width: `${Math.min(100, (record.approvals_count / Math.max(1, record.min_approvals)) * 100)}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-meta text-muted-foreground">Lo pide</p>
            <p className="text-compact font-medium">{record.requested_by.display_name}</p>
            <p className="text-meta text-muted-foreground">{formatDateTime(record.requested_at)}</p>
          </div>
          <div>
            <p className="text-meta text-muted-foreground">Plazo</p>
            <p className={cn("text-compact", expiry.urgent && "font-medium text-destructive")}>{expiry.text}</p>
            <p className="text-meta text-muted-foreground">{formatDateTime(record.expires_at)}</p>
          </div>
          <div>
            <h2 className="text-body font-semibold">Decisiones</h2>
            {record.decisions.length === 0 ? (
              <p className="mt-1 text-compact text-muted-foreground">Todavía no hay decisiones.</p>
            ) : (
              <ul className="mt-2 grid gap-3">
                {record.decisions.map((decision) => (
                  <li key={decision.id} className="text-compact">
                    <p className="font-medium">
                      {decision.decided_by.display_name} {decision.decision === "approve" ? "aprobó" : "rechazó"}
                    </p>
                    <p className="text-meta text-muted-foreground">
                      {formatDateTime(decision.decided_at)}
                      {decision.step_up_method === "passkey" ? " · passkey" : null}
                      {decision.step_up_method === "totp" ? " · código" : null}
                    </p>
                    {decision.note ? <p className="mt-1 break-words">{decision.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
      <RejectDialog
        open={rejectOpen}
        note={note}
        error={noteError}
        busy={busy}
        onNote={(value) => {
          setNote(value);
          if (noteError) setNoteError(noteProblem(value));
        }}
        onClose={() => {
          if (!busy) setRejectOpen(false);
        }}
        onConfirm={() => {
          const problem = noteProblem(note);
          setNoteError(problem);
          if (problem) return;
          void submit({ decision: "reject", note: note.trim() });
        }}
      />
      <StepUpDialog
        open={Boolean(stepUp)}
        decision={stepUp?.decision ?? "approve"}
        onClose={() => {
          if (!busy) setStepUp(null);
        }}
        onVerified={() => {
          if (stepUp) void submit(stepUp, true);
        }}
      />
    </div>
  );
}
