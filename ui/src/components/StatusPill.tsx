import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-status-neutral text-status-neutral-fg",
  info: "bg-status-info text-status-info-fg",
  success: "bg-status-success text-status-success-fg",
  warning: "bg-status-warning text-status-warning-fg",
  danger: "bg-status-danger text-status-danger-fg",
} as const;

export type StatusTone = keyof typeof tones;

export function StatusPill({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium", tones[tone])}>
      {children}
    </span>
  );
}
