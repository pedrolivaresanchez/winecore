import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { createFormat, createWine } from "@/pages/catalogo/api";
import { CatalogTabs } from "@/pages/catalogo/components/CatalogTabs";
import { Pill } from "@/pages/catalogo/components/Pill";
import { SectionTabs } from "@/pages/catalogo/components/SectionTabs";
import { formatVolumeMl } from "@/pages/catalogo/money";
import {
  categoryLabel,
  colorLabel,
  containerLabel,
  emptyFormatInput,
  emptyWineInput,
  type Format,
  type FormatInput,
  type ListPage,
  type Wine,
  type WineInput,
} from "@/pages/catalogo/model";
import { FormatForm, WineForm } from "@/pages/catalogo/ProductForm";
import { validateFormat, validateWine } from "@/pages/catalogo/validate";

export function WinesPage({ me }: { me: Me }) {
  const canWrite = allows(me, "catalog.write");
  const [params, setParams] = useSearchParams();
  const wines = useApi<ListPage<Wine>>("/v1/wines?limit=100");
  const formats = useApi<ListPage<Format>>("/v1/formats?limit=100");
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [section, setSection] = useState<"vinos" | "formatos">("vinos");
  const [sheet, setSheet] = useState<"vino" | "formato" | null>(null);

  useEffect(() => {
    const crear = params.get("crear");
    if (crear === "vino" || crear === "formato") setSheet(crear);
  }, [params]);

  function closeSheet() {
    setSheet(null);
    if (params.has("crear")) {
      const next = new URLSearchParams(params);
      next.delete("crear");
      setParams(next, { replace: true });
    }
  }

  const needle = q.trim().toLowerCase();
  const wineRows = (wines.data?.items ?? []).filter((wine) => {
    if (activeOnly && !wine.is_active) return false;
    if (!needle) return true;
    return wine.name.toLowerCase().includes(needle) || wine.code.toLowerCase().includes(needle);
  });
  const formatRows = (formats.data?.items ?? []).filter((format) => {
    if (activeOnly && !format.is_active) return false;
    if (!needle) return true;
    return format.name.toLowerCase().includes(needle) || format.code.toLowerCase().includes(needle);
  });

  const wineColumns = useMemo<Column<Wine>[]>(
    () => [
      { id: "code", header: "Código", cell: (row) => row.code },
      { id: "name", header: "Nombre", card: true, cell: (row) => <span className="font-medium">{row.name}</span> },
      { id: "color", header: "Color", card: true, cell: (row) => colorLabel(row.color) },
      { id: "category", header: "Categoría", cell: (row) => categoryLabel(row.category) },
      {
        id: "organic",
        header: "Ecológico",
        cell: (row) => (row.is_organic ? "Sí" : "No"),
      },
      {
        id: "active",
        header: "Activo",
        card: true,
        cell: (row) => <StatusPill tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Activo" : "Inactivo"}</StatusPill>,
      },
    ],
    [],
  );
  const formatColumns = useMemo<Column<Format>[]>(
    () => [
      { id: "code", header: "Código", card: true, cell: (row) => row.code },
      { id: "name", header: "Nombre", card: true, cell: (row) => <span className="font-medium">{row.name}</span> },
      { id: "container", header: "Envase", cell: (row) => containerLabel(row.container) },
      { id: "volume", header: "Volumen", align: "end", cell: (row) => formatVolumeMl(row.nominal_volume_ml) },
      { id: "case", header: "Uds/caja", align: "end", cell: (row) => String(row.units_per_case) },
      {
        id: "active",
        header: "Activo",
        card: true,
        cell: (row) => <StatusPill tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Activo" : "Inactivo"}</StatusPill>,
      },
    ],
    [],
  );

  if (!allows(me, "catalog.read")) return <NoPermission />;

  const loading = (wines.loading && !wines.data) || (formats.loading && !formats.data);
  const failed = wines.error ?? formats.error;
  const empty = !loading && !failed && (wines.data?.items.length ?? 0) === 0 && (formats.data?.items.length ?? 0) === 0 && !needle;
  const screen = loading ? "vinos-cargando" : empty ? "vinos-vacio" : "vinos";

  return (
    <div data-screen={screen} className="flex flex-col gap-4">
      <CatalogTabs />
      <PageHeader
        title="Vinos y formatos"
        description="La referencia comercial y el envase. El producto vendible es la combinación con la añada."
        actions={
          canWrite ? (
            <div className="inline-flex">
              <Button type="button" className="rounded-r-none" onClick={() => setSheet("vino")}>
                Nuevo vino
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-ink-foreground/20 px-2" aria-label="Más acciones">
                    <ChevronDown aria-hidden className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="min-h-11" onSelect={() => setSheet("formato")}>
                    Nuevo formato
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : undefined
        }
      />
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 bg-background px-4 py-2 md:static md:mx-0 md:px-0">
        <label className="sr-only" htmlFor="buscar-vinos">
          Buscar vino o formato
        </label>
        <Input
          id="buscar-vinos"
          type="search"
          value={q}
          placeholder="Buscar por nombre o código"
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill active={activeOnly} onClick={() => setActiveOnly((current) => !current)}>
          Activos
        </Pill>
      </div>
      {failed ? (
        <ErrorState
          title={`${copy.error.load} (${failed.code})`}
          detail={failed.message}
          onRetry={() => {
            wines.reload();
            formats.reload();
          }}
        />
      ) : (
        <>
          <div className="md:hidden">
            <SectionTabs
              id="vinos-seccion"
              label="Listas"
              tabs={[
                { id: "vinos", label: "Vinos" },
                { id: "formatos", label: "Formatos" },
              ]}
              value={section}
              onChange={setSection}
            />
          </div>
          <section className={section === "vinos" ? "grid gap-3" : "hidden gap-3 md:grid"}>
            <h2 className="text-body font-semibold">Vinos</h2>
            <DataTable
              label="Vinos"
              columns={wineColumns}
              rows={wineRows}
              rowKey={(row) => row.id}
              loading={loading}
              emptyTitle={needle || activeOnly ? "Ningún vino coincide" : "Aún no hay vinos"}
              emptyDescription={needle || activeOnly ? undefined : "Da de alta la referencia, por ejemplo un tinto de parcela."}
              emptyAction={
                canWrite && !needle && !activeOnly ? (
                  <Button type="button" onClick={() => setSheet("vino")}>
                    Nuevo vino
                  </Button>
                ) : undefined
              }
            />
          </section>
          <section className={section === "formatos" ? "grid gap-3" : "hidden gap-3 md:grid"}>
            <h2 className="text-body font-semibold">Formatos</h2>
            <DataTable
              label="Formatos"
              columns={formatColumns}
              rows={formatRows}
              rowKey={(row) => row.id}
              loading={loading}
              emptyTitle={needle || activeOnly ? "Ningún formato coincide" : "Aún no hay formatos"}
              emptyDescription={needle || activeOnly ? undefined : "Botella, mágnum o bag in box."}
              emptyAction={
                canWrite && !needle && !activeOnly ? (
                  <Button type="button" onClick={() => setSheet("formato")}>
                    Nuevo formato
                  </Button>
                ) : undefined
              }
            />
          </section>
        </>
      )}
      <WineSheet
        open={sheet === "vino"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        onCreated={() => {
          wines.reload();
          closeSheet();
        }}
      />
      <FormatSheet
        open={sheet === "formato"}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        onCreated={() => {
          formats.reload();
          closeSheet();
        }}
      />
    </div>
  );
}

function WineSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [value, setValue] = useState<WineInput>(emptyWineInput);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const idempotency = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setValue(emptyWineInput());
    setErrors({});
    idempotency.current = crypto.randomUUID();
  }, [open]);

  async function onSubmit() {
    const found = validateWine(value);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await createWine(value, idempotency.current);
      toast("Vino creado");
      onCreated();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else toast(error instanceof ApiError ? error.message : "No se ha podido crear el vino.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nuevo vino</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <form
            className="grid gap-4"
            data-screen="vino-alta"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit();
            }}
          >
            <WineForm value={value} onChange={setValue} errors={errors} disabled={saving} />
            <Button type="submit" disabled={saving}>
              {saving ? "Creando…" : "Crear vino"}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FormatSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [value, setValue] = useState<FormatInput>(emptyFormatInput);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const idempotency = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setValue(emptyFormatInput());
    setErrors({});
    idempotency.current = crypto.randomUUID();
  }, [open]);

  async function onSubmit() {
    const found = validateFormat(value);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await createFormat(value, idempotency.current);
      toast("Formato creado");
      onCreated();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else toast(error instanceof ApiError ? error.message : "No se ha podido crear el formato.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nuevo formato</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <form
            className="grid gap-4"
            data-screen="formato-alta"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit();
            }}
          >
            <FormatForm value={value} onChange={setValue} errors={errors} disabled={saving} />
            <Button type="submit" disabled={saving}>
              {saving ? "Creando…" : "Crear formato"}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
