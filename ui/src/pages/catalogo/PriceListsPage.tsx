import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable, type Column } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Input } from "@/components/ui/input";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { formatDate } from "@/lib/format";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { CatalogTabs } from "@/pages/catalogo/components/CatalogTabs";
import type { ListPage, PriceList } from "@/pages/catalogo/model";

export function PriceListsPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const lists = useApi<ListPage<PriceList>>("/v1/price-lists?limit=100");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = (lists.data?.items ?? []).filter((list) => {
    if (!needle) return true;
    return list.name.toLowerCase().includes(needle) || list.code.toLowerCase().includes(needle);
  });

  const columns = useMemo<Column<PriceList>[]>(
    () => [
      { id: "name", header: "Nombre", card: true, cell: (row) => <span className="font-medium">{row.name}</span> },
      { id: "code", header: "Código", card: true, cell: (row) => row.code },
      { id: "currency", header: "Moneda", cell: (row) => row.currency },
      { id: "tax", header: "IVA", cell: (row) => (row.tax_included ? "Incluido" : "Aparte") },
      {
        id: "version",
        header: "Versión activa",
        card: true,
        cell: (row) =>
          row.active_version
            ? `v${row.active_version}${row.active_valid_from ? ` · ${formatDate(row.active_valid_from)}` : ""}`
            : "—",
      },
      {
        id: "active",
        header: "Estado",
        cell: (row) => <StatusPill tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Activa" : "Inactiva"}</StatusPill>,
      },
    ],
    [],
  );

  if (!allows(me, "catalog.read")) return <NoPermission />;

  const loading = lists.loading && !lists.data;
  const empty = !loading && !lists.error && (lists.data?.items.length ?? 0) === 0;
  const screen = loading ? "tarifas-cargando" : empty ? "tarifas-vacio" : "tarifas";

  return (
    <div data-screen={screen} className="flex flex-col gap-4">
      <CatalogTabs />
      <PageHeader
        title="Tarifas"
        description="Precios por canal. Cada cambio es una versión nueva y se activa con aprobación."
      />
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 bg-background px-4 py-2 md:static md:mx-0 md:px-0">
        <label className="sr-only" htmlFor="buscar-tarifas">
          Buscar tarifa
        </label>
        <Input
          id="buscar-tarifas"
          type="search"
          value={q}
          placeholder="Buscar por nombre o código"
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      {lists.error ? (
        <ErrorState title={`${copy.error.load} (${lists.error.code})`} detail={lists.error.message} onRetry={lists.reload} />
      ) : (
        <DataTable
          label="Tarifas"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          onRowClick={(row) => navigate(`/catalogo/tarifas/${row.id}`)}
          emptyTitle={needle ? "Ninguna tarifa coincide" : "Aún no hay tarifas"}
          emptyDescription={needle ? undefined : "Las tarifas de cliente final, distribuidor y tienda aparecen aquí."}
        />
      )}
    </div>
  );
}
