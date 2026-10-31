import { cn } from "@/lib/utils";

export function Pill({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "h-11 rounded-full px-3 text-compact md:h-8",
        active ? "bg-ink font-medium text-ink-foreground" : "bg-muted text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
