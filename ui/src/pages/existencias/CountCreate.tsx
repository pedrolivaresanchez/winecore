import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { Field } from "@/components/Field";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, TextArea } from "@/components/ui/native-field";
import { copy } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { entityName } from "@/lib/labels";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { useEntity } from "@/app/entity-context";
import { AtField } from "@/pages/existencias/components/AtField";
import { createCount, ownerEntityId, type CountKind, type StockLocation } from "@/pages/existencias/api";
import { explainStockError } from "@/pages/existencias/explain";
import { COUNT_KINDS } from "@/pages/existencias/labels";
import { OPENING_COUNT_ISO } from "@/pages/existencias/time";
import { useList } from "@/pages/existencias/use-list";

function isKind(value: string | null): value is CountKind {
  return COUNT_KINDS.some((item) => item.id === value);
}

export function CountCreate({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { filter, entities } = useEntity();
  const preset = ownerEntityId(filter, entities);
  const kindParam = params.get("kind");
  const initialKind: CountKind = isKind(kindParam) ? kindParam : "periodic";
  const [kind, setKind] = useState<CountKind>(initialKind);
  const [countedAt, setCountedAt] = useState(initialKind === "opening" ? OPENING_COUNT_ISO : new Date().toISOString());
  const [entityId, setEntityId] = useState(preset ?? entities[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locations = useList<StockLocation>(allows(me, "inventory.count") ? "/v1/locations" : null);

  if (!allows(me, "inventory.read")) return <NoPermission />;
  if (!allows(me, "inventory.count")) return <NoPermission />;

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function submit() {
    if (!entityId) {
      setError("Elige la entidad del recuento.");
      return;
    }
    if (selected.length === 0) {
      setError("Elige al menos una ubicación.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createCount(
        {
          kind,
          counted_at: kind === "opening" ? OPENING_COUNT_ISO : countedAt,
          location_ids: selected,
          legal_entity_id: entityId,
          notes: notes.trim() || undefined,
        },
        crypto.randomUUID(),
      );
      navigate(`/stock/aforos/${created.id}`);
    } catch (err: unknown) {
      const apiError = err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load);
      setError(explainStockError(apiError));
      setBusy(false);
    }
  }

  return (
    <div data-screen="aforo-nuevo" className="flex min-w-0 flex-col gap-4">
      <Link to="/stock/aforos" className="text-compact text-muted-foreground">
        Aforos
      </Link>
      <PageHeader title="Nuevo aforo" description="Elige el tipo, la fecha y las ubicaciones. El libro se compara al cerrar el recuento." />
      <fieldset className="grid gap-2">
        <legend className="text-compact font-medium">Tipo</legend>
        <div className="flex flex-wrap gap-2">
          {COUNT_KINDS.map((item) => (
            <label key={item.id} className="flex min-h-11 items-center gap-2 rounded-full bg-muted px-3 text-compact">
              <input
                type="radio"
                name="kind"
                checked={kind === item.id}
                onChange={() => {
                  setKind(item.id);
                  if (item.id === "opening") setCountedAt(OPENING_COUNT_ISO);
                }}
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "opening" ? (
        <Field id="counted_at" label="Fecha de corte" hint="Queda fijada el 31/12/2026, 23:59. Solo puede haber un aforo de arranque por entidad.">
          <Input id="counted_at" value={formatDateTime(OPENING_COUNT_ISO)} disabled />
        </Field>
      ) : (
        <AtField label="Fecha del recuento" iso={countedAt} onChange={setCountedAt} />
      )}
      <Field id="legal_entity_id" label="Entidad">
        <NativeSelect
          id="legal_entity_id"
          value={entityId}
          disabled={Boolean(preset)}
          onChange={(event) => setEntityId(event.target.value)}
        >
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entityName(entity.code)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <fieldset className="grid gap-2">
        <legend className="text-compact font-medium">Ubicaciones</legend>
        {locations.loading ? <p className="text-compact text-muted-foreground">{copy.loading}</p> : null}
        {locations.error ? <ErrorState title={`${copy.error.load} (${locations.error.code})`} detail={locations.error.message} onRetry={locations.reload} /> : null}
        {!locations.loading && locations.items.length === 0 ? <p className="text-compact text-muted-foreground">No hay ubicaciones activas.</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {locations.items.filter((item) => item.is_active).map((item) => (
            <label key={item.id} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-compact">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
              <span className="min-w-0">
                <span className="block font-medium">{item.name}</span>
                <span className="text-meta text-muted-foreground">{item.code}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field id="notes" label="Notas">
        <TextArea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      {error ? <ErrorState title={error} framed={false} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void submit()}>
          {busy ? "Creando…" : "Crear aforo"}
        </Button>
        <Button asChild variant="secondary">
          <Link to="/stock/aforos">Cancelar</Link>
        </Button>
      </div>
    </div>
  );
}
