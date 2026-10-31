import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { contentLabel, fillPercent, holding, kindLabel, type CellarOperation, type CleaningRecord, type Vessel, type VesselLabel } from "@/lib/cellar";
import { formatDateTime, formatLitres } from "@/lib/format";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";

type Detail = Vessel & { cleanings?: CleaningRecord[] };
type HistoryPage = { items: CellarOperation[] };

const TABS = [
  { id: "contenido", label: "Contenido" },
  { id: "historial", label: "Historial" },
  { id: "limpiezas", label: "Limpiezas" },
  { id: "qr", label: "QR" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const OP_LABEL: Record<string, string> = {
  racking: "Trasiego",
  blend: "Ensamblaje",
  filtration: "Filtración",
  bottling: "Envasado",
  labeling: "Etiquetado",
  addition: "Adición",
  loss: "Merma",
  destruction: "Destrucción",
  cleaning: "Limpieza",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  confirmed: "Confirmada",
  rectified: "Rectificada",
  discarded: "Descartada",
};

export function DepositoPage({ me }: { me: Me }) {
  const { vesselId = "" } = useParams();
  const path = allows(me, "cellar.read") && vesselId ? `/v1/vessels/${encodeURIComponent(vesselId)}` : null;
  const data = useApi<Detail>(path);
  const history = useApi<HistoryPage>(path ? `${path}/history?limit=20` : null);
  const [tab, setTab] = useState<TabId>("contenido");
  const canOperate = allows(me, "cellar.operate");

  if (!allows(me, "cellar.read")) return <NoPermission />;
  if (data.loading && !data.data) {
    return (
      <div aria-busy="true" className="grid gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-36" />
      </div>
    );
  }
  if (data.error || !data.data) {
    return <ErrorState title={`No se ha podido cargar (${data.error?.code ?? "WC_ERROR"})`} detail={data.error?.message} onRetry={data.reload} />;
  }

  const vessel = data.data;
  const operations = history.data?.items ?? [];
  const cleanings = vessel.cleanings ?? [];
  const pct = fillPercent(vessel);
  const inside = holding(vessel);
  const nueva = `/bodega/operacion/nueva?tipo=racking&vessel=${encodeURIComponent(vessel.code)}`;
  const limpieza = `/bodega/operacion/nueva?tipo=cleaning&vessel=${encodeURIComponent(vessel.code)}`;

  return (
    <div data-screen="bodega-deposito" data-tab={tab} className="flex min-w-0 flex-col gap-4">
      <Link to="/bodega" className="text-compact text-muted-foreground">
        ← Depósitos
      </Link>
      <PageHeader
        title={vessel.code}
        description={`${vessel.name} · ${kindLabel(vessel.kind)}`}
        actions={
          <>
            {canOperate ? (
              <Button asChild>
                <Link to={nueva}>Operación</Link>
              </Button>
            ) : null}
            {canOperate ? (
              <Button asChild variant="secondary">
                <Link to={limpieza}>Limpieza</Link>
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => setTab("qr")}>
              QR
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Litros" value={formatLitres((inside?.volume_ml ?? 0) / 1000)} />
        <Metric label="Capacidad" value={formatLitres(vessel.capacity_ml / 1000)} />
        <Metric label="Llenado" value={`${pct} %`} />
      </div>

      <div className="md:hidden">
        <label className="sr-only" htmlFor="deposito-seccion">
          Sección
        </label>
        <NativeSelect id="deposito-seccion" value={tab} onChange={(event) => setTab(event.target.value as TabId)}>
          {TABS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="hidden flex-wrap gap-2 md:flex" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`h-11 rounded-full px-3 text-compact ${tab === item.id ? "bg-ink text-ink-foreground" : "bg-muted"}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "contenido" ? <Content vessel={vessel} pct={pct} /> : null}
      {tab === "historial" ? <History operations={operations} /> : null}
      {tab === "limpiezas" ? <Cleanings cleanings={cleanings} /> : null}
      {tab === "qr" ? <QrPanel code={vessel.code} fallback={vessel.qr_token ?? null} /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="text-compact font-semibold break-words tabular-nums">{value}</p>
    </div>
  );
}

function Content({ vessel, pct }: { vessel: Vessel; pct: number }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <p className="text-body font-medium">{contentLabel(vessel)}</p>
      {holding(vessel) ? (
        <Link to={`/lotes/${encodeURIComponent(holding(vessel)!.lot_code)}`} className="text-compact underline">
          {holding(vessel)?.lot_code} · {holding(vessel)?.wine_name}
          {holding(vessel)?.vintage ? ` · ${holding(vessel)?.vintage}` : ""}
        </Link>
      ) : (
        <p className="text-compact text-muted-foreground">Sin vino dentro.</p>
      )}
      <div className="h-3 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Llenado ${pct} %`}>
        <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      {vessel.alert ? <p className="text-compact text-status-warning-fg">{vessel.alert}</p> : null}
      <dl className="grid gap-2 text-compact">
        <Row label="Zona" value={vessel.zone || "—"} />
        <Row label="Material" value={materialLabel(vessel.material)} />
        <Row label="Estado" value={statusLabel(vessel.status)} />
        {vessel.kind === "tank_fermenter" ? <Row label="Camisa de frío" value={vessel.has_cooling_jacket ? "Sí" : "No"} /> : null}
        {vessel.sisv_code ? <Row label="Código SISV" value={vessel.sisv_code} /> : null}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function History({ operations }: { operations: CellarOperation[] }) {
  if (operations.length === 0) return <p className="text-compact text-muted-foreground">Sin operaciones.</p>;
  return (
    <ul className="grid gap-2">
      {operations.map((operation) => (
        <li key={operation.id} className="rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body font-medium">{OP_LABEL[operation.op_type] ?? operation.op_type}</p>
            <StatusPill tone={operation.status === "confirmed" ? "success" : operation.status === "draft" ? "warning" : "neutral"}>
              {STATUS_LABEL[operation.status] ?? operation.status}
            </StatusPill>
          </div>
          <p className="mt-1 text-meta text-muted-foreground">
            {formatDateTime(operation.occurred_at)} · {operation.performed_by}
            {operation.number ? ` · ${operation.number}` : ""}
          </p>
          {operation.reason ? <p className="mt-1 text-compact">{operation.reason}</p> : null}
          {operation.approval_request_id ? (
            <Link className="mt-2 inline-flex min-h-11 items-center text-compact font-medium underline" to={`/aprobaciones/${operation.approval_request_id}`}>
              Pendiente de aprobación
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Cleanings({ cleanings }: { cleanings: CleaningRecord[] }) {
  if (cleanings.length === 0) return <p className="text-compact text-muted-foreground">Sin limpiezas registradas.</p>;
  return (
    <ul className="grid gap-2">
      {cleanings.map((cleaning) => (
        <li key={cleaning.id} className="rounded-xl border bg-card p-3">
          <p className="text-body font-medium">{cleaning.active_substance}</p>
          <p className="text-meta text-muted-foreground">
            {cleaning.quantity} {cleaning.quantity_unit} · {cleaning.efficacy_check} · {formatDateTime(cleaning.created_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function QrPanel({ code, fallback }: { code: string; fallback: string | null }) {
  const data = useApi<VesselLabel>(`/v1/vessels/${encodeURIComponent(code)}/qr`);
  const token = data.data?.qr_token ?? fallback ?? "";
  const url = data.data?.payload ?? `${window.location.origin}/bodega/${encodeURIComponent(code)}`;
  return (
    <div className="grid max-w-sm gap-3">
      <section className="print-area grid gap-3 rounded-xl border bg-card p-4">
        <p className="text-compact text-muted-foreground">Etiqueta para pegar en el depósito.</p>
        <QrMark code={code} />
        <p className="text-center text-body font-semibold">{code}</p>
        <p className="text-center text-meta break-all text-muted-foreground">{url}</p>
        {token ? <p className="text-center text-meta break-all text-muted-foreground">{token}</p> : null}
      </section>
      <Button type="button" variant="secondary" onClick={() => window.print()}>
        Imprimir QR
      </Button>
    </div>
  );
}

function materialLabel(material: Vessel["material"]): string {
  if (material === "stainless_steel") return "Acero";
  if (material === "oak") return "Roble";
  if (material === "glass") return "Vidrio";
  if (material === "concrete") return "Hormigón";
  if (material === "plastic") return "Plástico";
  return "Otro";
}

function statusLabel(status: Vessel["status"]): string {
  if (status === "out_of_service") return "Fuera de servicio";
  if (status === "retired") return "Baja";
  return "En servicio";
}

function QrMark({ code }: { code: string }) {
  const cells = code.split("").map((char, index) => (char.charCodeAt(0) + index) % 2 === 0);
  return (
    <svg viewBox="0 0 21 21" className="mx-auto size-40 bg-card" role="img" aria-label={`QR de ${code}`}>
      {Array.from({ length: 21 * 21 }, (_, index) => {
        const x = index % 21;
        const y = Math.floor(index / 21);
        const on = (cells[(x * 3 + y * 5) % Math.max(cells.length, 1)] ?? false) || (x < 4 && y < 4) || (x > 16 && y < 4) || (x < 4 && y > 16);
        return on ? <rect key={index} x={x} y={y} width="1" height="1" className="fill-foreground" /> : null;
      })}
    </svg>
  );
}
