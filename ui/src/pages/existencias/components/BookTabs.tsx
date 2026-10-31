import { cn } from "@/lib/utils";

export function BookTabs({
  value,
  onChange,
  label = "Libro",
}: {
  value: "physical" | "fiscal";
  onChange: (value: "physical" | "fiscal") => void;
  label?: string;
}) {
  const tabs = [
    { id: "physical" as const, label: "Físico" },
    { id: "fiscal" as const, label: "Fiscal" },
  ];
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full rounded-lg bg-muted p-0.5">
      {tabs.map((tab) => {
        const selected = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={cn(
              "h-11 min-w-16 rounded-md px-3 text-compact md:h-8",
              selected ? "bg-ink font-medium text-ink-foreground" : "text-foreground",
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
