import { useEffect } from "react";
import { useEntity } from "@/app/entity-context";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { approvalsPath } from "@/pages/aprobaciones/api";
import { onApprovalsChanged } from "@/pages/aprobaciones/events";

export function PendingBadge({ variant = "inline" }: { variant?: "inline" | "corner" }) {
  const { entityCode } = useEntity();
  const result = useApi<{ total?: number }>(
    approvalsPath({ status: "pending", entity: entityCode ?? undefined }),
  );

  useEffect(() => onApprovalsChanged(result.reload), [result.reload]);

  const total = result.data?.total ?? 0;
  if (total <= 0) return null;
  const label = total > 99 ? "99+" : String(total);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-status-warning font-medium text-status-warning-fg tabular-nums",
        variant === "corner"
          ? "absolute top-1 right-1 min-h-4 min-w-4 px-1 text-meta"
          : "ml-auto min-h-5 min-w-5 px-1.5 text-meta",
      )}
    >
      <span className="sr-only">{label} pendientes</span>
      <span aria-hidden>{label}</span>
    </span>
  );
}
