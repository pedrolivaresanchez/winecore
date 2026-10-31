import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useChromeTitle } from "@/app/shell/shell-context";
import { useMinWidth } from "@/hooks/use-media";
import { ArrowLeft, ArrowRight, Key, MoreVertical } from "@/ui/icons";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { iconStroke } from "@/lib/motion";
import { useApi } from "@/hooks/use-api";
import { decideApproval } from "@/pages/aprobaciones/api";
import { notifyApprovalsChanged } from "@/pages/aprobaciones/events";
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
import { presentPayload } from "@/pages/aprobaciones/payload";
import { RejectDialog } from "@/pages/aprobaciones/RejectDialog";
import { StepUpDialog } from "@/pages/aprobaciones/StepUpDialog";
import {
  Alert,
  Badge,
  Button,
  GlassMenu,
  InfoTip,
  MenuItem,
  Skeleton,
  useMenuOpen,
  useToast,
} from "@/ui";

type PendingAction = { decision: "approve" | "reject"; note?: string };

export function ApprovalDetail({ id, backTo }: { id: string; backTo: string }) {
  useChromeTitle(copy.approvals.title);
  const wide = useMinWidth(768);
  const toast = useToast();
  const more = useMenuOpen();
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
      toast(action.decision === "approve" ? copy.approvals.approvedToast : copy.approvals.rejectedToast, {
        tone: "success",
      });
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
      setBanner(error instanceof ApiError ? explainError(error) : copy.approvals.decideFail);
      setStepUp(null);
    } finally {
      setBusy(false);
    }
  }

  if (approval.loading && !approval.data) {
    return (
      <div data-screen="aprobacion-cargando" aria-busy="true" className="flex flex-col gap-3 p-4">
        <p className="sr-only">{copy.loading}</p>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (approval.error || !approval.data) {
    return (
      <div className="p-4">
        <Alert tone="danger">{`${copy.error.load} (${approval.error?.code ?? "WC_ERROR"})`}</Alert>
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={approval.reload}>
          {copy.error.retry}
        </Button>
      </div>
    );
  }

  const record = approval.data;
  const status = statusMeta(record.status);
  const expiry = expiryLabel(record.expires_at, record.status, Date.now());
  const canAct = record.status === "pending" && record.can_decide;
  const presented = presentPayload(record.payload_display ?? []);
  const noteText = closedNote(record.status);
  const fraction = Math.min(100, (record.approvals_count / Math.max(1, record.min_approvals)) * 100);

  const actions = canAct ? (
    <div className="flex items-center gap-1.5">
      <Button type="button" size="sm" loading={busy && !rejectOpen} onClick={() => void submit({ decision: "approve" })}>
        <Key aria-hidden strokeWidth={iconStroke} />
        {copy.approvals.approve}
      </Button>
      <GlassMenu
        open={more.open}
        onOpenChange={more.setOpen}
        placement="bottom-end"
        trigger={
          <Button type="button" variant="secondary" size="sm" iconOnly aria-label={copy.approvals.more} onClick={more.toggle}>
            <MoreVertical strokeWidth={iconStroke} />
          </Button>
        }
      >
        <MenuItem
          tone="danger"
          onClick={() => {
            more.close();
            setRejectOpen(true);
          }}
        >
          {copy.approvals.reject}
        </MenuItem>
      </GlassMenu>
    </div>
  ) : null;

  return (
    <div data-screen="aprobacion" data-status={record.status} className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-1.5 sm:px-4">
        <Link
          to={backTo}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-900 hover:bg-fill-hover"
          aria-label={copy.approvals.back}
        >
          <ArrowLeft className="size-3.5" strokeWidth={iconStroke} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-label font-medium text-ink-900">{record.title}</h1>
          <p className="truncate text-caption text-text-tertiary">
            {kindLabel(record.kind)} · {entityLabel(record.legal_entity_code)}
          </p>
        </div>
        <Badge tone={status.tone} dot size="sm">
          {status.label}
        </Badge>
        {wide ? actions : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-6">
        {banner ? (
          <Alert tone="danger" className="mb-4">
            {banner}
          </Alert>
        ) : null}
        {record.status === "pending" && record.reason_cannot_decide ? (
          <Alert tone="warning" className="mb-4">
            {record.reason_cannot_decide}
          </Alert>
        ) : null}
        {noteText ? <p className="mb-4 text-label text-text-secondary">{noteText}</p> : null}
        {canAct && wide ? <p className="mb-4 text-caption text-text-tertiary">{copy.approvals.phrase}</p> : null}

        <section className="rounded-2xl border border-border-subtle px-4 py-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-caption font-medium text-ink-900">{copy.approvals.hash}</h3>
            <InfoTip label={copy.approvals.hash}>{copy.approvals.hashHelp}</InfoTip>
          </div>
          <p className="mt-1 font-mono text-body font-medium tracking-wide text-ink-900">{shortHash(record.payload_sha256)}</p>
          <p className="mt-1 font-mono text-caption break-all text-text-tertiary">{record.payload_sha256}</p>
        </section>

        <section className="mt-6">
          <h3 className="text-label font-medium text-ink-900">{copy.approvals.payload}</h3>
          {presented.lines.length === 0 ? (
            <p className="mt-2 text-label text-text-secondary">{record.summary}</p>
          ) : (
            <dl className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
              {presented.lines.map((row) => (
                <div key={`${row.label}-${row.value}`} className="grid gap-0.5 px-4 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline sm:gap-3">
                  <dt className="text-caption text-text-tertiary">{row.label}</dt>
                  <dd className="text-label break-words whitespace-pre-wrap text-ink-900">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {presented.diffs.length > 0 ? (
          <section className="mt-6">
            <h3 className="text-label font-medium text-ink-900">{copy.approvals.diff}</h3>
            <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
              {presented.diffs.map((diff) => (
                <li key={`${diff.label}-${diff.before}-${diff.after}`} className="px-4 py-3">
                  <p className="text-label font-medium text-ink-900">{diff.label}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-caption">
                    <span className="text-text-tertiary line-through">{diff.before}</span>
                    <ArrowRight className="size-3 text-icon-muted" strokeWidth={iconStroke} />
                    <span className="font-medium text-ink-900">{diff.after}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-caption text-text-tertiary">{copy.approvals.quorum}</dt>
            <dd className="mt-1 text-label font-medium tabular-nums text-ink-900">{quorumLabel(record.approvals_count, record.min_approvals)}</dd>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-100" aria-hidden>
              <div className="h-full bg-ink-900" style={{ width: `${fraction}%` }} />
            </div>
          </div>
          <div>
            <dt className="text-caption text-text-tertiary">{copy.approvals.requester}</dt>
            <dd className="mt-1 text-label font-medium text-ink-900">{record.requested_by.display_name}</dd>
            <dd className="text-caption text-text-tertiary">{formatDateTime(record.requested_at)}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-tertiary">{copy.approvals.deadline}</dt>
            <dd className={cn("mt-1 text-label font-medium", expiry.urgent ? "text-danger-600" : "text-ink-900")}>{expiry.text}</dd>
            <dd className="text-caption text-text-tertiary">{formatDateTime(record.expires_at)}</dd>
          </div>
        </dl>

        <section className="mt-6">
          <h3 className="text-label font-medium text-ink-900">{copy.approvals.decisions}</h3>
          {record.decisions.length === 0 ? (
            <p className="mt-2 text-label text-text-secondary">{copy.approvals.noDecisions}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
              {record.decisions.map((decision, index) => (
                <li key={decision.id ?? `${decision.decided_at}-${index}`} className="px-4 py-3">
                  <p className="text-label text-ink-900">
                    <span className="font-medium">{decision.decided_by.display_name}</span>{" "}
                    {decision.decision === "approve" ? copy.approvals.approvedVerb : copy.approvals.rejectedVerb}
                  </p>
                  <p className="text-caption text-text-tertiary">
                    {formatDateTime(decision.decided_at)}
                    {decision.step_up_method === "passkey" ? ` · ${copy.approvals.viaPasskey}` : null}
                    {decision.step_up_method === "totp" ? ` · ${copy.approvals.viaCode}` : null}
                  </p>
                  {decision.note ? <p className="mt-1 text-label break-words text-ink-900">{decision.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </div>

      {canAct && !wide ? (
        <div className="shrink-0 border-t border-border-subtle bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="mb-2 text-center text-caption text-text-secondary">{copy.approvals.phrase}</p>
          <div className="flex justify-end">{actions}</div>
        </div>
      ) : null}

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

export function ApprovalPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const query = params.toString();
  return <ApprovalDetail id={id} backTo={query ? `/aprobaciones?${query}` : "/aprobaciones"} />;
}
