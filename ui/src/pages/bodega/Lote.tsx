import { Link, useParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import type { Lot, Traceability, TraceNode } from "@/lib/cellar";
import { formatLitres, formatPercent } from "@/lib/format";
import { allows } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";

const KIND: Record<string, string> = {
  grape: "Uva",
  must: "Mosto",
  wine: "Vino",
  bottled: "Envasado",
};

const STATUS: Record<string, string> = {
  active: "Activo",
  depleted: "Agotado",
  closed: "Cerrado",
};

function formatAmount(volumeMl: number, massG = 0): string {
  if (volumeMl > 0) return formatLitres(volumeMl / 1000);
  if (massG > 0) {
    const kg = massG / 1000;
    const [whole, frac] = kg.toFixed(3).split(".");
    const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${grouped},${frac} kg`;
  }
  return formatLitres(0);
}

export function LotePage({ me }: { me: Me }) {
  const { lotId = "" } = useParams();
  const lot = useApi<Lot>(allows(me, "cellar.read") && lotId ? `/v1/lots/${encodeURIComponent(lotId)}` : null);
  const trace = useApi<Traceability>(allows(me, "cellar.read") && lotId ? `/v1/lots/${encodeURIComponent(lotId)}/traceability?direction=both` : null);

  if (!allows(me, "cellar.read")) return <NoPermission />;
  if (lot.loading && !lot.data) {
    return (
      <div aria-busy="true" className="grid gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (lot.error || !lot.data) {
    return <ErrorState title={`No se ha podido cargar (${lot.error?.code ?? "WC_ERROR"})`} detail={lot.error?.message} onRetry={lot.reload} />;
  }

  const item = lot.data;
  const places = item.positions.filter((place) => (place.vessel_code ?? "") !== "" && place.volume_ml !== 0);
  const volumeMl = places.reduce((sum, place) => sum + place.volume_ml, 0);

  return (
    <div data-screen="bodega-lote" className="flex min-w-0 flex-col gap-5">
      <Link to="/bodega" className="text-compact text-muted-foreground">
        ← Depósitos
      </Link>
      <PageHeader
        title={item.code}
        description={[KIND[item.kind] ?? item.kind, item.wine_name, item.vintage].filter(Boolean).join(" · ")}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Volumen" value={formatLitres(volumeMl / 1000)} />
        <Metric label="Estado" value={STATUS[item.status]} />
        <Metric label="Tipo" value={KIND[item.kind] ?? item.kind} />
        <Metric label="Cultivo" value={item.is_organic ? "Ecológico" : "Convencional"} />
      </div>

      <section className="grid gap-2">
        <h2 className="text-body font-semibold">Dónde está</h2>
        {places.length === 0 ? (
          <p className="text-compact text-muted-foreground">No está en ningún depósito.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {places.map((place) => (
              <li key={`${place.vessel_code}-${place.location_code}`}>
                <Link to={`/bodega/${encodeURIComponent(place.vessel_code ?? "")}`} className="block rounded-xl border bg-card p-3">
                  <p className="text-body font-medium">{place.vessel_code}</p>
                  <p className="text-compact tabular-nums">{formatLitres(place.volume_ml / 1000)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="text-body font-semibold">Composición</h2>
        <Composition trace={trace.data} current={item.code} />
      </section>

      <section className="grid min-w-0 gap-2">
        <h2 className="text-body font-semibold">Genealogía</h2>
        {trace.loading ? <Skeleton className="h-24" /> : null}
        {trace.error ? <ErrorState framed={false} title={trace.error.message} onRetry={trace.reload} /> : null}
        {trace.data ? <Genealogy trace={trace.data} current={item.code} /> : null}
      </section>

      <section className="grid gap-2">
        <h2 className="text-body font-semibold">Analíticas</h2>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-body font-medium">Sin analíticas</p>
          <p className="mt-1 text-compact text-muted-foreground">El laboratorio se conectará más adelante.</p>
        </div>
      </section>

      {item.notes ? <p className="text-compact text-muted-foreground">{item.notes}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-3">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p className="text-compact font-semibold break-words">{value}</p>
    </div>
  );
}

function nodeCode(trace: Traceability, lotId: string): string {
  return trace.nodes.find((node) => node.lot_id === lotId)?.code ?? lotId;
}

function edgeEnds(trace: Traceability, edge: Traceability["edges"][number]): { parent: string; child: string } {
  return {
    parent: edge.parent_code ?? nodeCode(trace, edge.parent_lot_id),
    child: edge.child_code ?? nodeCode(trace, edge.child_lot_id),
  };
}

function Composition({ trace, current }: { trace: Traceability | null; current: string }) {
  if (!trace) return <p className="text-compact text-muted-foreground">Cargando el origen…</p>;
  const parents = trace.edges.filter((edge) => edgeEnds(trace, edge).child === current);
  if (parents.length === 0) return <p className="text-compact text-muted-foreground">Lote de origen, sin padres.</p>;
  const volumeTotal = parents.reduce((sum, edge) => sum + edge.volume_ml, 0);
  return (
    <ul className="grid gap-2">
      {parents.map((edge) => {
        const pct = volumeTotal > 0 ? (edge.volume_ml / volumeTotal) * 100 : null;
        return (
          <li key={edgeEnds(trace, edge).parent} className="rounded-xl border bg-card p-3 text-compact">
            <Link to={`/lotes/${encodeURIComponent(edgeEnds(trace, edge).parent)}`} className="font-medium underline">
              {edgeEnds(trace, edge).parent}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {formatAmount(edge.volume_ml, edge.mass_g)}
              {pct !== null ? ` · ${formatPercent(pct)}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Genealogy({ trace, current }: { trace: Traceability; current: string }) {
  const rows = treeRows(trace);
  const levels = generations(trace);
  return (
    <>
      <ul className="grid gap-1 lg:hidden" data-tree="lista">
        {rows.map(({ node, depth }) => (
          <li key={node.code} className="min-h-11 border-l border-border py-1 pl-3" style={{ marginLeft: depth * 12 }}>
            {node.code === current ? (
              <span className="text-compact font-semibold">{node.code} · este lote</span>
            ) : (
              <Link to={`/lotes/${encodeURIComponent(node.code)}`} className="text-compact underline">
                {node.code}
              </Link>
            )}
            <span className="text-meta text-muted-foreground">
              {" "}
              · {KIND[node.kind] ?? node.kind}
              {node.vintage ? ` · ${node.vintage}` : ""}
              {node.volume_ml ? ` · ${formatAmount(node.volume_ml, node.mass_g)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden min-w-0 lg:block">
        <div className="flex items-center gap-2 overflow-x-auto pb-2" data-tree="grafo">
          {levels.map((level, index) => (
            <div key={level[0]?.code ?? index} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              ) : null}
              <div className="grid content-start gap-3">
                {level.map((node) => (
                  <div key={node.code} className={cn("w-40 rounded-xl border bg-card p-3", node.code === current && "border-2 border-ink")}>
                    <p className="text-compact font-semibold">{node.code}</p>
                    <p className="text-meta text-muted-foreground">{KIND[node.kind] ?? node.kind}</p>
                    {node.wine_name ? <p className="truncate text-meta">{node.wine_name}</p> : null}
                    {node.vintage ? <p className="text-meta text-muted-foreground">{node.vintage}</p> : null}
                    {node.volume_ml ? <p className="text-meta tabular-nums">{formatAmount(node.volume_ml, node.mass_g)}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function treeRows(trace: Traceability): { node: TraceNode; depth: number }[] {
  const byCode = new Map(trace.nodes.map((node) => [node.code, node]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of trace.edges) {
    const ends = edgeEnds(trace, edge);
    children.set(ends.parent, [...(children.get(ends.parent) ?? []), ends.child]);
    hasParent.add(ends.child);
  }
  const roots = trace.nodes.filter((node) => !hasParent.has(node.code));
  const rows: { node: TraceNode; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (code: string, depth: number) => {
    if (seen.has(code) || depth > 8) return;
    const node = byCode.get(code);
    if (!node) return;
    seen.add(code);
    rows.push({ node, depth });
    for (const child of children.get(code) ?? []) walk(child, depth + 1);
  };
  for (const root of roots.length > 0 ? roots : trace.nodes) walk(root.code, 0);
  return rows;
}

function generations(trace: Traceability): TraceNode[][] {
  const depth = new Map<string, number>();
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of trace.edges) {
    const ends = edgeEnds(trace, edge);
    children.set(ends.parent, [...(children.get(ends.parent) ?? []), ends.child]);
    hasParent.add(ends.child);
  }
  const roots = trace.nodes.map((node) => node.code).filter((code) => !hasParent.has(code));
  const queue = (roots.length > 0 ? roots : trace.nodes.map((node) => node.code)).map((code) => ({ code, level: 0 }));
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || depth.has(item.code)) continue;
    depth.set(item.code, item.level);
    for (const child of children.get(item.code) ?? []) queue.push({ code: child, level: item.level + 1 });
  }
  const levels: TraceNode[][] = [];
  for (const node of trace.nodes) {
    const level = depth.get(node.code) ?? 0;
    levels[level] = [...(levels[level] ?? []), node];
  }
  return levels.filter((level) => level.length > 0);
}
