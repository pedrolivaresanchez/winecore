import type { ReactNode } from "react";

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex min-h-11 min-w-0 items-baseline justify-between gap-3 py-3 sm:flex-col sm:items-start sm:rounded-xl sm:bg-muted/70 sm:px-4 sm:py-4">
      <p className="text-meta text-muted-foreground">{label}</p>
      <p
        className="min-w-0 text-right text-body font-semibold break-words tabular-nums sm:text-left sm:text-title"
        title={hint}
      >
        {value}
      </p>
    </div>
  );
}
