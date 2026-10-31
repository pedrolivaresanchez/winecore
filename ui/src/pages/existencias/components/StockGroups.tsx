import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StockBalance } from "@/pages/existencias/api";
import { balanceKey } from "@/pages/existencias/api";
import { ownerLabel, productLabel, stateLabel } from "@/pages/existencias/labels";
import type { StockGroup } from "@/pages/existencias/groups";
import { formatMl, formatUnits } from "@/pages/existencias/volume";

function place(row: StockBalance): string {
  return row.vessel_code ?? "Sin recipiente";
}

export function StockGroups({
  groups,
  onOpen,
  selectedKey,
}: {
  groups: StockGroup[];
  onOpen: (row: StockBalance) => void;
  selectedKey?: string;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="grid min-w-0 gap-4">
      {groups.map((group) => {
        const open = !closed.has(group.id);
        return (
          <section key={group.id} className="min-w-0">
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-3 text-left"
              aria-expanded={open}
              onClick={() => toggle(group.id)}
            >
              <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">
                  {group.name} <span className="font-normal text-muted-foreground">({group.code})</span>
                </span>
              </span>
              <span className="shrink-0 text-right text-compact font-medium tabular-nums">
                {formatMl(group.volumeMl)}
                {group.units > 0 ? <span className="mt-0.5 block text-meta font-normal text-muted-foreground">{formatUnits(group.units)} ud</span> : null}
              </span>
            </button>
            {open ? (
              <>
                <div className="mt-2 hidden min-w-0 overflow-x-auto border border-border md:block">
                  <table className="w-full border-collapse text-compact">
                    <caption className="sr-only">Existencias en {group.name}</caption>
                    <thead>
                      <tr>
                        {["Recipiente", "Lote", "Producto o vino", "Estado", "Propietario", "Litros", "Unidades"].map((header) => (
                          <th
                            key={header}
                            className={cn(
                              "h-11 border border-border bg-muted px-2 text-left font-medium",
                              (header === "Litros" || header === "Unidades") && "text-right",
                            )}
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => {
                        const key = balanceKey(row);
                        return (
                          <tr
                            key={key}
                            data-state={selectedKey === key ? "selected" : undefined}
                            tabIndex={0}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => onOpen(row)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onOpen(row);
                              }
                            }}
                          >
                            <td className="border border-border px-2 py-2">{place(row)}</td>
                            <td className="border border-border px-2 py-2">
                              {row.lot_code ? (
                                <Link
                                  to={`/lotes/${row.lot_code}`}
                                  className="underline underline-offset-2"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {row.lot_code}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="border border-border px-2 py-2">{productLabel(row)}</td>
                            <td className="border border-border px-2 py-2">{stateLabel(row.product_state)}</td>
                            <td className="border border-border px-2 py-2">{ownerLabel(row.owner_code)}</td>
                            <td className="border border-border px-2 py-2 text-right tabular-nums">{formatMl(row.volume_ml)}</td>
                            <td className="border border-border px-2 py-2 text-right tabular-nums">
                              {row.qty_units ? formatUnits(row.qty_units) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ul className="mt-2 grid gap-3 md:hidden">
                  {group.rows.map((row) => (
                    <li key={balanceKey(row)}>
                      <button type="button" className="w-full rounded-xl border bg-card p-4 text-left card-shadow" onClick={() => onOpen(row)}>
                        <p className="text-body font-medium break-words">{row.vessel_code ?? productLabel(row)}</p>
                        <dl className="mt-2 grid gap-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-meta text-muted-foreground">Lote</dt>
                            <dd className="min-w-0 text-right text-compact break-words">{row.lot_code ?? "—"}</dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-meta text-muted-foreground">{row.qty_units ? "Unidades" : "Litros"}</dt>
                            <dd className="text-compact tabular-nums">{row.qty_units ? formatUnits(row.qty_units) : formatMl(row.volume_ml)}</dd>
                          </div>
                        </dl>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
