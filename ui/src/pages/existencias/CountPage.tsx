import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { CountSheet, type LineDraft } from "@/pages/existencias/components/CountSheet";
import { Notice } from "@/pages/existencias/components/Notice";
import { QrScanField } from "@/pages/existencias/components/QrScanField";
import {
  closeCount,
  requestCountPosting,
  saveCountLines,
  type CountLine,
  type CountLineInput,
  type InventoryCount,
} from "@/pages/existencias/api";
import { explainStockError } from "@/pages/existencias/explain";
import { lineGap } from "@/pages/existencias/filters";
import { countKindLabel, countStatusLabel, countStatusTone, isPackaged, ownerLabel } from "@/pages/existencias/labels";
import { clearPending, readPending, writePending } from "@/pages/existencias/pending";
import { formatMl, formatSignedMl, formatSignedUnits } from "@/pages/existencias/volume";

function draftsFrom(lines: CountLine[]): Record<string, LineDraft> {
  const drafts: Record<string, LineDraft> = {};
  for (const line of lines) {
    drafts[line.id] = {
      counted_volume_ml: line.counted_volume_ml,
      counted_qty_units: line.counted_qty_units,
      method: line.method,
      difference_reason: line.difference_reason ?? "",
      photoName: null,
    };
  }
  return drafts;
}

function capacityErrors(lines: CountLine[], drafts: Record<string, LineDraft>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const line of lines) {
    const draft = drafts[line.id];
    if (!draft || isPackaged(line.product_state)) continue;
    if (draft.counted_volume_ml != null && line.vessel_capacity_ml != null && draft.counted_volume_ml > line.vessel_capacity_ml) {
      errors[line.id] = `El volumen supera la capacidad del recipiente (${formatMl(line.vessel_capacity_ml)}).`;
    }
  }
  return errors;
}

function missingCounts(lines: CountLine[], drafts: Record<string, LineDraft>): boolean {
  return lines.some((line) => {
    const draft = drafts[line.id];
    if (!draft) return true;
    return isPackaged(line.product_state) ? draft.counted_qty_units == null : draft.counted_volume_ml == null;
  });
}

function missingReasons(lines: CountLine[], drafts: Record<string, LineDraft>): string[] {
  return lines.flatMap((line) => {
    const draft = drafts[line.id];
    if (!draft) return [];
    const gap = lineGap({ ...line, counted_volume_ml: draft.counted_volume_ml, counted_qty_units: draft.counted_qty_units });
    if (gap == null || gap === 0 || draft.difference_reason.trim()) return [];
    return [line.vessel_code ?? line.lot_code ?? "una línea"];
  });
}

function toInputs(lines: CountLine[], drafts: Record<string, LineDraft>): CountLineInput[] {
  return lines.map((line) => {
    const draft = drafts[line.id];
    const packaged = isPackaged(line.product_state);
    const units = draft?.counted_qty_units ?? null;
    const volume = packaged
      ? units == null || line.nominal_volume_ml == null
        ? null
        : units * line.nominal_volume_ml
      : (draft?.counted_volume_ml ?? null);
    return {
      id: line.id,
      location_id: line.location_id,
      vessel_id: line.vessel_id,
      owner_entity_id: line.owner_entity_id,
      lot_id: line.lot_id,
      product_id: line.product_id,
      product_state: line.product_state,
      counted_qty_units: packaged ? units : volume == null ? null : 0,
      counted_volume_ml: volume,
      method: draft?.method ?? null,
      difference_reason: draft?.difference_reason.trim() ? draft.difference_reason.trim() : null,
    };
  });
}

function diffSummary(lines: CountLine[]): string[] {
  return lines.flatMap((line) => {
    const gap = lineGap(line);
    if (gap == null || gap === 0) return [];
    const amount = isPackaged(line.product_state) ? `${formatSignedUnits(gap)} ud` : formatSignedMl(gap);
    return [`${line.vessel_code ?? line.lot_code ?? "Línea"} ${amount}`];
  });
}

function screenOf(count: InventoryCount): string {
  const lines = count.lines ?? [];
  const diffs = lines.some((line) => {
    const gap = lineGap(line);
    return gap != null && gap !== 0;
  });
  if (count.kind === "opening") return "aforo-arranque";
  if (count.approval_request_id && count.status !== "posted" && count.status !== "approved") return "aforo-aprobacion";
  if (diffs) return "aforo-diferencias";
  return "aforo";
}

export function CountPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const count = useApi<InventoryCount>(id ? `/v1/inventory-counts/${id}` : null);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [syncPending, setSyncPending] = useState(false);
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"close" | "post" | null>(null);
  const canCount = allows(me, "inventory.count");
  const data = count.data;
  const lines = useMemo(() => data?.lines ?? [], [data]);

  useEffect(() => {
    if (!data) return;
    const pending = readPending<Record<string, LineDraft>>(data.id);
    if (pending) {
      setSyncPending(true);
      setDrafts(pending);
      return;
    }
    setSyncPending(false);
    setDrafts(draftsFrom(data.lines ?? []));
  }, [data]);

  useEffect(() => {
    const needle = scan.trim().toLocaleLowerCase("es");
    if (!needle || lines.length === 0) return;
    const line = lines.find((item) => `${item.vessel_code ?? ""} ${item.qr_token ?? ""} ${item.lot_code ?? ""}`.toLocaleLowerCase("es").includes(needle));
    if (!line) return;
    const nodes = document.querySelectorAll(`[data-line="${line.id}"]`);
    const visible = [...nodes].find((node) => node instanceof HTMLElement && node.offsetParent !== null);
    visible?.scrollIntoView({ block: "center" });
  }, [lines, scan]);

  const errors = useMemo(() => capacityErrors(lines, drafts), [drafts, lines]);
  const pendingApproval = Boolean(data?.approval_request_id && data.status !== "posted" && data.status !== "approved");
  const volumesEditable = Boolean(canCount && data && (data.status === "draft" || data.status === "counting") && !pendingApproval);
  const reasonsEditable = Boolean(canCount && data && (data.status === "draft" || data.status === "counting" || data.status === "review") && !pendingApproval);

  function patchDraft(lineId: string, patch: Partial<LineDraft>) {
    setDrafts((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } as LineDraft }));
  }

  async function persist() {
    if (!data) return;
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await saveCountLines(data.id, toInputs(lines, drafts));
      clearPending(data.id);
      setSyncPending(false);
      toast("Recuento guardado");
      count.reload();
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, "WC_ERROR", copy.error.load);
      if (apiError.status === 0 || apiError.code === "WC_NETWORK") {
        writePending(data.id, drafts);
        setSyncPending(true);
        toast("Sin conexión. Pendiente de sincronizar.");
      } else {
        setActionError(explainStockError(apiError));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmClose() {
    if (!data) return;
    setDialog(null);
    if (missingCounts(lines, drafts)) {
      setActionError("Faltan recipientes por contar.");
      return;
    }
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await saveCountLines(data.id, toInputs(lines, drafts));
      await closeCount(data.id);
      clearPending(data.id);
      setSyncPending(false);
      toast("Recuento cerrado");
      count.reload();
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, "WC_ERROR", copy.error.load);
      setActionError(explainStockError(apiError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPost() {
    if (!data) return;
    setDialog(null);
    const reasons = missingReasons(lines, drafts);
    if (reasons.length > 0) {
      setActionError(`Falta el motivo de la diferencia en ${reasons.join(", ")}.`);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (reasonsEditable) await saveCountLines(data.id, toInputs(lines, drafts));
      await requestCountPosting(data.id, crypto.randomUUID());
      toast("Solicitud enviada");
      count.reload();
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : new ApiError(0, "WC_ERROR", copy.error.load);
      setActionError(explainStockError(apiError));
    } finally {
      setBusy(false);
    }
  }

  if (!allows(me, "inventory.read")) return <NoPermission />;

  if (count.loading && !data) {
    return (
      <div data-screen="aforo-cargando" aria-busy="true" className="grid gap-3">
        <p className="sr-only">{copy.loading}</p>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (count.error || !data) {
    return (
      <div data-screen="aforo-error">
        <ErrorState title={`${copy.error.load} (${count.error?.code ?? "WC_ERROR"})`} detail={count.error?.message} onRetry={count.reload} />
      </div>
    );
  }

  return (
    <div data-screen={screenOf(data)} className="flex min-w-0 flex-col gap-4">
      <Link to="/stock/aforos" className="text-compact text-muted-foreground">
        Aforos
      </Link>
      <PageHeader
        title={data.number ?? "Aforo sin número"}
        description={`${countKindLabel(data.kind)} · ${formatDateTime(data.counted_at)} · ${ownerLabel(data.legal_entity_code)}`}
        actions={
          canCount ? (
            <>
              {volumesEditable || (reasonsEditable && data.status === "review") ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void persist()}>
                  Guardar
                </Button>
              ) : null}
              {volumesEditable ? (
                <Button type="button" disabled={busy} onClick={() => setDialog("close")}>
                  Cerrar recuento
                </Button>
              ) : null}
              {reasonsEditable && data.status === "review" && !data.approval_request_id ? (
                <Button type="button" disabled={busy} onClick={() => setDialog("post")}>
                  Pedir contabilización
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={pendingApproval ? "warning" : countStatusTone(data.status)}>
          {pendingApproval ? "Pendiente de aprobación" : countStatusLabel(data.status)}
        </StatusPill>
        <span className="text-compact text-muted-foreground">{data.location_codes.join(" · ")}</span>
      </div>
      {diffSummary(lines).length > 0 ? <p className="text-compact">Diferencias: {diffSummary(lines).join(" · ")}</p> : null}
      {data.kind === "opening" ? (
        <Notice title="Aforo de arranque del 31/12/2026">
          Al contabilizarlo crea los saldos iniciales de los dos libros y la existencia inicial A01 de SILICIE. No se puede repetir para la misma fecha.
        </Notice>
      ) : null}
      {pendingApproval && data.approval_request_id ? (
        <Notice tone="warning" title="Pendiente de aprobación">
          <Link className="underline underline-offset-2" to={`/aprobaciones/${data.approval_request_id}`}>
            Ver la solicitud
          </Link>
          <p className="mt-1">El stock no cambia hasta que se apruebe.</p>
        </Notice>
      ) : null}
      {syncPending ? (
        <Notice tone="warning" title="Pendiente de sincronizar">
          Las líneas están en este dispositivo. Se enviarán al recuperar la conexión.
          <div className="mt-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void persist()}>
              Reintentar
            </Button>
          </div>
        </Notice>
      ) : null}
      {data.signed_at ? (
        <p className="text-compact text-muted-foreground">
          Firmado por {data.signed_by_name ?? "quien contó"} el {formatDateTime(data.signed_at)}.
        </p>
      ) : canCount && volumesEditable ? (
        <p className="text-compact text-muted-foreground">Al cerrar, firmas el recuento como {me.display_name}.</p>
      ) : null}
      {data.notes ? <p className="text-compact">{data.notes}</p> : null}
      {actionError ? (
        <ErrorState title={actionError} framed />
      ) : null}
      <QrScanField value={scan} onChange={setScan} />
      <CountSheet
        lines={lines}
        drafts={drafts}
        errors={errors}
        scan={scan}
        volumesEditable={volumesEditable}
        reasonsEditable={reasonsEditable}
        onDraft={patchDraft}
      />
      <p className="text-meta text-muted-foreground">La diferencia es lo contado menos el libro. Un ajuste que dejara el saldo en negativo se rechaza.</p>
      <ConfirmDialog
        open={dialog === "close"}
        title="Cerrar recuento"
        body={`Se calcularán las diferencias con el libro. Firmas como ${me.display_name}.`}
        confirmLabel="Cerrar recuento"
        busy={busy}
        onConfirm={() => void confirmClose()}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "post"}
        title="Pedir contabilización"
        body="Se enviará a aprobación con las diferencias. Hasta que se apruebe, el stock no cambia."
        confirmLabel="Pedir aprobación"
        busy={busy}
        onConfirm={() => void confirmPost()}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
