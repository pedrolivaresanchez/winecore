import { cn } from "@/lib/utils";
import { formatMl, formatUnits } from "@/pages/existencias/volume";

export type LocationSummary = {
  id: string;
  code: string;
  name: string;
  volumeMl: number;
  units: number;
};

export function LocationCards({
  items,
  selectedId,
  onSelect,
}: {
  items: LocationSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={selected}
            className={cn(
              "min-w-0 rounded-xl border bg-card p-3 text-left card-shadow md:p-4",
              selected ? "border-ink" : "border-border",
            )}
            onClick={() => onSelect(selected ? "" : item.id)}
          >
            <p className="text-meta text-muted-foreground">{item.code}</p>
            <p className="truncate text-body font-medium">{item.name}</p>
            <p className="mt-2 text-compact font-semibold break-words tabular-nums">{formatMl(item.volumeMl)}</p>
            {item.units > 0 ? <p className="text-meta text-muted-foreground tabular-nums">{formatUnits(item.units)} ud</p> : null}
          </button>
        );
      })}
    </div>
  );
}
