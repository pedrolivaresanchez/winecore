import { useEffect } from "react";
import { useEntity } from "@/app/entity-context";
import { useApi } from "@/hooks/use-api";
import { copy, fill } from "@/i18n";
import { CountBadge } from "@/ui";
import { approvalsPath } from "@/pages/aprobaciones/api";
import { onApprovalsChanged } from "@/pages/aprobaciones/events";

/** Pending approvals, as the rail's work-waiting count. */
export function PendingBadge({ inline = false, size = "md" }: { inline?: boolean; size?: "md" | "sm" }) {
  const { entityCode } = useEntity();
  const result = useApi<{ total?: number }>(approvalsPath({ status: "pending", entity: entityCode ?? undefined }));

  useEffect(() => onApprovalsChanged(result.reload), [result.reload]);

  const total = result.data?.total ?? 0;
  if (total <= 0) return null;
  const title = fill(copy.approvals.pendingCount, { n: total > 99 ? "99+" : String(total) });
  return <CountBadge count={total} tone="danger" inline={inline} size={size} title={title} />;
}
