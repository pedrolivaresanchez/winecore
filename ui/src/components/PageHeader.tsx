import { useEffect, type ReactNode } from "react";
import { copy } from "@/i18n";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  useEffect(() => {
    const previous = document.title;
    document.title = title === copy.appName ? title : `${title} · ${copy.appName}`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-title font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="mt-1 text-body break-words text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
