import { NativeSelect } from "@/components/ui/native-field";
import { cn } from "@/lib/utils";
import type { CountLine, CountMethod } from "@/pages/existencias/api";
import { lineGap } from "@/pages/existencias/filters";
import { COUNT_METHODS, isPackaged, methodLabel, ownerLabel, productLabel, stateLabel } from "@/pages/existencias/labels";
import { UnitsInput, VolumeInput } from "@/pages/existencias/components/VolumeInput";
import { formatMl, formatSignedMl, formatSignedUnits, formatUnits } from "@/pages/existencias/volume";

export type LineDraft = {
  counted_volume_ml: number | null;
  counted_qty_units: number | null;
  method: CountMethod | null;
  difference_reason: string;
  photoName: string | null;
};

function bookText(line: CountLine): string {
  if (isPackaged(line.product_state)) return `${formatUnits(line.expected_qty_units)} ud`;
  return formatMl(line.expected_volume_ml);
}

function diffText(line: CountLine, draft: LineDraft): string {
  const gap = lineGap({ ...line, counted_volume_ml: draft.counted_volume_ml, counted_qty_units: draft.counted_qty_units });
  if (gap == null) return "—";
  return isPackaged(line.product_state) ? formatSignedUnits(gap) : formatSignedMl(gap);
}

function diffValue(line: CountLine, draft: LineDraft): number | null {
  return lineGap({ ...line, counted_volume_ml: draft.counted_volume_ml, counted_qty_units: draft.counted_qty_units });
}

export function CountSheet({
  lines,
  drafts,
  errors,
  scan,
  volumesEditable,
  reasonsEditable,
  onDraft,
}: {
  lines: CountLine[];
  drafts: Record<string, LineDraft>;
  errors: Record<string, string>;
  scan: string;
  volumesEditable: boolean;
  reasonsEditable: boolean;
  onDraft: (id: string, patch: Partial<LineDraft>) => void;
}) {
  const groups = new Map<string, { name: string; code: string; lines: CountLine[] }>();
  for (const line of lines) {
    const group = groups.get(line.location_id) ?? { name: line.location_name, code: line.location_code, lines: [] };
    group.lines.push(line);
    groups.set(line.location_id, group);
  }
  const needle = scan.trim().toLocaleLowerCase("es");

  return (
    <div className="grid min-w-0 gap-6">
      {[...groups.entries()].map(([id, group]) => (
        <section key={id} className="min-w-0">
          <h2 className="text-body font-semibold">
            {group.name} <span className="font-normal text-muted-foreground">({group.code})</span>
          </h2>
          <div className="mt-2 hidden min-w-0 overflow-x-auto border border-border md:block">
            <table className="w-full border-collapse text-compact">
              <caption className="sr-only">Recuento en {group.name}</caption>
              <thead>
                <tr>
                  {["Recipiente", "Lote", "Libro", "Contado", "Diferencia", "Motivo", "Método"].map((header) => (
                    <th key={header} className={cn("h-11 border border-border bg-muted px-2 text-left font-medium", (header === "Libro" || header === "Contado" || header === "Diferencia") && "text-right")}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.lines.map((line) => {
                  const draft = drafts[line.id];
                  if (!draft) return null;
                  const gap = diffValue(line, draft);
                  const active = needle.length > 0 && (`${line.vessel_code ?? ""} ${line.lot_code ?? ""} ${line.qr_token ?? ""}`).toLocaleLowerCase("es").includes(needle);
                  return (
                    <tr key={line.id} data-line={line.id} className={active ? "bg-accent" : undefined}>
                      <td className="border border-border px-2 py-2 align-top">
                        <p className="font-medium">{line.vessel_code ?? productLabel(line)}</p>
                        <p className="text-meta text-muted-foreground">{stateLabel(line.product_state)} · {ownerLabel(line.owner_code)}</p>
                      </td>
                      <td className="border border-border px-2 py-2 align-top">{line.lot_code ?? "—"}</td>
                      <td className="border border-border px-2 py-2 text-right align-top tabular-nums">{bookText(line)}</td>
                      <td className="w-40 border border-border px-2 py-2 align-top">
                        <CountControl line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} suffix="d" />
                        {errors[line.id] ? <p className="mt-1 text-meta text-destructive">{errors[line.id]}</p> : null}
                      </td>
                      <td className={cn("border border-border px-2 py-2 text-right align-top tabular-nums", gap != null && gap < 0 && "text-destructive")}>{diffText(line, draft)}</td>
                      <td className="w-48 border border-border px-2 py-2 align-top">
                        <ReasonField line={line} draft={draft} gap={gap} editable={reasonsEditable} onDraft={onDraft} />
                      </td>
                      <td className="w-40 border border-border px-2 py-2 align-top">
                        <MethodField line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} />
                        <PhotoField lineId={line.id} draft={draft} editable={volumesEditable || reasonsEditable} onDraft={onDraft} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 grid gap-3 md:hidden">
            {group.lines.map((line) => {
              const draft = drafts[line.id];
              if (!draft) return null;
              const gap = diffValue(line, draft);
              const active = needle.length > 0 && (`${line.vessel_code ?? ""} ${line.lot_code ?? ""} ${line.qr_token ?? ""}`).toLocaleLowerCase("es").includes(needle);
              return (
                <li key={line.id} data-line={line.id} className={cn("rounded-xl border bg-card p-4 card-shadow", active && "border-ink")}>
                  <p className="text-body font-medium">{line.vessel_code ?? productLabel(line)}</p>
                  <p className="text-meta text-muted-foreground break-words">
                    {line.lot_code ?? "Sin lote"} · {stateLabel(line.product_state)} · {ownerLabel(line.owner_code)}
                  </p>
                  <dl className="mt-3 grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-meta text-muted-foreground">Libro</dt>
                      <dd className="text-compact tabular-nums">{bookText(line)}</dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-meta text-muted-foreground">Contado</dt>
                      <dd>
                        <CountControl line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} suffix="m" />
                        {errors[line.id] ? <p className="mt-1 text-meta text-destructive">{errors[line.id]}</p> : null}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-meta text-muted-foreground">Diferencia</dt>
                      <dd className={cn("text-compact font-medium tabular-nums", gap != null && gap < 0 && "text-destructive")}>{diffText(line, draft)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 grid gap-3">
                    <ReasonField line={line} draft={draft} gap={gap} editable={reasonsEditable} onDraft={onDraft} />
                    <MethodField line={line} draft={draft} editable={volumesEditable} onDraft={onDraft} />
                    <PhotoField lineId={line.id} draft={draft} editable={volumesEditable || reasonsEditable} onDraft={onDraft} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CountControl({
  line,
  draft,
  editable,
  onDraft,
  suffix,
}: {
  line: CountLine;
  draft: LineDraft;
  editable: boolean;
  onDraft: (id: string, patch: Partial<LineDraft>) => void;
  suffix: string;
}) {
  if (!editable) {
    if (isPackaged(line.product_state)) return <p className="text-right tabular-nums">{draft.counted_qty_units == null ? "—" : `${formatUnits(draft.counted_qty_units)} ud`}</p>;
    return <p className="text-right tabular-nums">{draft.counted_volume_ml == null ? "—" : formatMl(draft.counted_volume_ml)}</p>;
  }
  if (isPackaged(line.product_state)) {
    return <UnitsInput id={`ud-${line.id}-${suffix}`} units={draft.counted_qty_units} onCommit={(units) => onDraft(line.id, { counted_qty_units: units })} />;
  }
  return <VolumeInput id={`l-${line.id}-${suffix}`} ml={draft.counted_volume_ml} onCommit={(ml) => onDraft(line.id, { counted_volume_ml: ml })} />;
}

function ReasonField({
  line,
  draft,
  gap,
  editable,
  onDraft,
}: {
  line: CountLine;
  draft: LineDraft;
  gap: number | null;
  editable: boolean;
  onDraft: (id: string, patch: Partial<LineDraft>) => void;
}) {
  if (gap === 0 || gap == null) return <p className="text-meta text-muted-foreground">{draft.difference_reason || "—"}</p>;
  if (!editable) return <p>{draft.difference_reason || "Falta el motivo"}</p>;
  return (
    <textarea
      aria-label={`Motivo de la diferencia de ${line.vessel_code ?? line.lot_code ?? "la línea"}`}
      value={draft.difference_reason}
      placeholder="Motivo de la diferencia"
      rows={2}
      className="min-h-11 w-full resize-y rounded-md border border-input bg-background px-2 py-1 text-compact md:min-h-14"
      onChange={(event) => onDraft(line.id, { difference_reason: event.target.value })}
    />
  );
}

function MethodField({
  line,
  draft,
  editable,
  onDraft,
}: {
  line: CountLine;
  draft: LineDraft;
  editable: boolean;
  onDraft: (id: string, patch: Partial<LineDraft>) => void;
}) {
  if (!editable) return <p>{methodLabel(draft.method)}</p>;
  return (
    <NativeSelect
      aria-label={`Método de ${line.vessel_code ?? line.lot_code ?? "la línea"}`}
      value={draft.method ?? ""}
      className="md:h-9"
      onChange={(event) => onDraft(line.id, { method: (event.target.value || null) as CountMethod | null })}
    >
      <option value="">Método</option>
      {COUNT_METHODS.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </NativeSelect>
  );
}

function PhotoField({
  lineId,
  draft,
  editable,
  onDraft,
}: {
  lineId: string;
  draft: LineDraft;
  editable: boolean;
  onDraft: (id: string, patch: Partial<LineDraft>) => void;
}) {
  if (!editable) return draft.photoName ? <p className="text-meta text-muted-foreground">{draft.photoName}</p> : null;
  return (
    <label className="mt-1 flex min-h-11 cursor-pointer items-center text-meta text-muted-foreground">
      <span className="truncate">{draft.photoName ?? "Foto opcional"}</span>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => onDraft(lineId, { photoName: event.target.files?.[0]?.name ?? null })}
      />
    </label>
  );
}
