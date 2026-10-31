import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QrCode } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { contentLabel, fillPercent, holding, kindLabel, type Vessel } from "@/lib/cellar";
import { formatLitres } from "@/lib/format";
import { allows } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";

type List = { items: Vessel[]; next_cursor: string | null; total: number };

function vesselTargetFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const qr = text.match(/\/q\/([^/?#]+)/);
  if (qr?.[1]) return `/q/${decodeURIComponent(qr[1])}`;
  const bodega = text.match(/\/bodega\/([^/?#]+)/);
  if (bodega?.[1]) return `/bodega/${decodeURIComponent(bodega[1])}`;
  if (/^[A-Za-z0-9_-]{16,64}$/.test(text) && text.startsWith("wcqr_")) return `/q/${text}`;
  if (/^[A-Z0-9-]{2,20}$/.test(text)) return `/bodega/${text}`;
  return null;
}

export function MapaPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const data = useApi<List>(allows(me, "cellar.read") ? "/v1/vessels?limit=100" : null);
  const [zone, setZone] = useState("");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [onlyFull, setOnlyFull] = useState(false);
  const [table, setTable] = useState(false);
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState("");

  const zones = useMemo(() => {
    const names = new Set((data.data?.items ?? []).map((item) => item.zone || "Sin zona"));
    return [...names];
  }, [data.data]);

  const items = (data.data?.items ?? []).filter((item) => {
    if (zone && (item.zone || "Sin zona") !== zone) return false;
    if (kind && item.kind !== kind) return false;
    if (onlyFull && (holding(item)?.volume_ml ?? 0) <= 0) return false;
    if (query.trim()) {
      const haystack = `${item.code} ${item.name} ${item.lot_code ?? ""} ${item.wine_name ?? ""}`.toLowerCase();
      if (!haystack.includes(query.trim().toLowerCase())) return false;
    }
    return true;
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Vessel[]>();
    for (const item of items) {
      const key = item.zone || "Sin zona";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  if (!allows(me, "cellar.read")) return <NoPermission />;

  const source = data.data?.items ?? [];
  const empty = !data.loading && source.length === 0;
  const litres = items.reduce((sum, item) => sum + (holding(item)?.volume_ml ?? 0), 0);
  const full = items.filter((item) => (holding(item)?.volume_ml ?? 0) > 0).length;

  return (
    <div data-screen={empty ? "bodega-vacio" : "bodega-mapa"} data-view={table ? "tabla" : "tarjetas"} className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Depósitos"
        description="Qué hay en cada depósito, barrica y damajuana."
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setScan(true)}>
              <QrCode aria-hidden className="size-4" />
              Escanear QR
            </Button>
            <Button type="button" variant="secondary" className="hidden md:inline-flex" onClick={() => setTable((value) => !value)}>
              {table ? "Tarjetas" : "Tabla"}
            </Button>
          </div>
        }
      />

      <div className="flex min-w-0 items-center gap-2">
        <div className="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          <Filter active={zone === "" && !onlyFull && kind === ""} onClick={() => { setZone(""); setKind(""); setOnlyFull(false); }}>
            Todos
          </Filter>
          {zones.map((name) => (
            <Filter key={name} active={zone === name} onClick={() => setZone(zone === name ? "" : name)}>
              {name}
            </Filter>
          ))}
          <Filter active={onlyFull} onClick={() => setOnlyFull((value) => !value)}>
            Ocupados
          </Filter>
          <Filter active={kind === "barrel"} onClick={() => setKind(kind === "barrel" ? "" : "barrel")}>
            Barricas
          </Filter>
          <Filter active={kind === "tank_fermenter"} onClick={() => setKind(kind === "tank_fermenter" ? "" : "tank_fermenter")}>
            Fermentadores
          </Filter>
        </div>
      </div>

      <Input
        id="bodega-buscar"
        value={query}
        placeholder="Lote, vino o código"
        onChange={(event) => setQuery(event.target.value)}
        className="md:max-w-xs"
      />

      {data.loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : data.error ? (
        <ErrorState title={`No se ha podido cargar (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />
      ) : empty ? (
        <EmptyState title="Aún no hay depósitos" description="Cuando estén dados de alta aparecerán aquí, agrupados por nave." />
      ) : items.length === 0 ? (
        <EmptyState title="Nada coincide con los filtros" />
      ) : (
        <>
          <p className="text-compact text-muted-foreground">
            {items.length === source.length ? `${items.length} depósitos` : `${items.length} de ${source.length} depósitos`}
            {` · ${full} con vino · ${formatLitres(litres / 1000)}`}
          </p>
          {table ? (
            <VesselTable items={items} />
          ) : (
            <div className="grid gap-6">
              {grouped.map(([name, group]) => (
                <section key={name} className="grid gap-3">
                  <h2 className="text-body font-semibold">
                    {name}
                    <span className="ml-2 text-compact font-normal text-muted-foreground">· {group.length}</span>
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.map((vessel) => (
                      <VesselCard key={vessel.id} vessel={vessel} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <Sheet open={scan} onOpenChange={setScan}>
        <SheetContent side="bottom" data-screen="bodega-qr">
          <SheetHeader>
            <SheetTitle>Escanear QR</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 px-4 pb-6"
            onSubmit={(event) => {
              event.preventDefault();
              const next = vesselTargetFromScan(code);
              if (!next) return;
              setScan(false);
              navigate(next);
            }}
          >
            <label className="text-compact text-muted-foreground" htmlFor="qr-url">
              El lector escribe el enlace del depósito.
            </label>
            <Input id="qr-url" autoFocus value={code} placeholder="https://…/q/wcqr_…" onChange={(event) => setCode(event.target.value)} />
            <Button type="submit">Abrir depósito</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Filter({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "h-11 shrink-0 rounded-full px-3 text-compact whitespace-nowrap",
        active ? "bg-ink font-medium text-ink-foreground" : "bg-muted",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function VesselCard({ vessel }: { vessel: Vessel }) {
  const pct = fillPercent(vessel);
  const litres = holding(vessel)?.volume_ml ?? 0;
  return (
    <Link
      to={`/bodega/${encodeURIComponent(vessel.code)}`}
      className={cn(
        "flex min-h-36 min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 card-shadow",
        vessel.alert && "border-status-warning-fg",
        vessel.status !== "in_service" && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body font-semibold">{vessel.code}</p>
          <p className="truncate text-compact text-muted-foreground">{vessel.name}</p>
        </div>
        <p className="shrink-0 text-meta text-muted-foreground">{kindLabel(vessel.kind)}</p>
      </div>
      <p className="truncate text-compact">
        {holding(vessel) ? `${holding(vessel)?.lot_code} · ${holding(vessel)?.wine_name}` : contentLabel(vessel)}
      </p>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Llenado ${pct} %`}
      >
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-meta tabular-nums">
        <span>
          {formatLitres(litres / 1000)}
          <span className="text-muted-foreground"> / {formatLitres(vessel.capacity_ml / 1000)}</span>
        </span>
        <span className="text-muted-foreground">{contentLabel(vessel)} · {pct} %</span>
      </div>
      {vessel.alert ? <p className="text-meta text-status-warning-fg">{vessel.alert}</p> : null}
    </Link>
  );
}

function VesselTable({ items }: { items: Vessel[] }) {
  return (
    <div className="hidden min-w-0 overflow-x-auto md:block">
      <table className="w-full border-collapse text-compact">
        <thead>
          <tr>
            {["Código", "Zona", "Vino", "Litros", "Capacidad", "Estado"].map((header) => (
              <th key={header} className="border border-border bg-muted px-3 py-2 text-left font-medium whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((vessel) => (
            <tr key={vessel.id} className="hover:bg-accent">
              <td className="border border-border px-3 py-2 font-medium whitespace-nowrap">
                <Link to={`/bodega/${encodeURIComponent(vessel.code)}`}>{vessel.code}</Link>
              </td>
              <td className="border border-border px-3 py-2">{vessel.zone || "—"}</td>
              <td className="border border-border px-3 py-2">{vessel.wine_name ?? "—"}</td>
              <td className="border border-border px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatLitres((holding(vessel)?.volume_ml ?? 0) / 1000)}</td>
              <td className="border border-border px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatLitres(vessel.capacity_ml / 1000)}</td>
              <td className="border border-border px-3 py-2 whitespace-nowrap">{contentLabel(vessel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
