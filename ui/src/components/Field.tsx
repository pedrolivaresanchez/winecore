import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-meta text-destructive">
          {error}
        </p>
      ) : null}
      {hint && !error ? <p className="text-meta text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
