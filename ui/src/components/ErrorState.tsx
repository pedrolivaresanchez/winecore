import { Button } from "@/components/ui/button";
import { copy } from "@/i18n";

export function ErrorState({
  title,
  detail,
  onRetry,
  framed = true,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  framed?: boolean;
}) {
  return (
    <div
      role="alert"
      className={framed ? "flex flex-col items-start gap-3 rounded-xl border bg-card p-4 card-shadow" : "flex flex-col items-start gap-3"}
    >
      <p className="text-body font-medium">{title}</p>
      {detail ? <p className="text-compact text-muted-foreground">{detail}</p> : null}
      {onRetry ? (
        <Button type="button" onClick={onRetry}>
          {copy.error.retry}
        </Button>
      ) : null}
    </div>
  );
}
