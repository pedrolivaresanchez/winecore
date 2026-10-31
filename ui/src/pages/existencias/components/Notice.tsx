import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3",
        tone === "warning" ? "bg-status-warning text-status-warning-fg" : "border bg-card",
      )}
    >
      <p className="text-body font-medium">{title}</p>
      {children ? <div className="mt-1 text-compact">{children}</div> : null}
    </div>
  );
}
