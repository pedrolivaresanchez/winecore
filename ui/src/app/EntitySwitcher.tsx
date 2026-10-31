import { useRef } from "react";
import { copy } from "@/i18n";
import { entityName } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { useEntity } from "@/app/entity-context";
import type { EntityChoice } from "@/lib/types";

export function EntitySwitcher() {
  const { filter, setFilter, entities } = useEntity();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const options: { value: EntityChoice; label: string }[] = [
    { value: "all", label: copy.entity.all },
    ...entities.map((entity) => ({ value: entity.code, label: entityName(entity.code) })),
  ];

  function move(from: number, direction: 1 | -1) {
    const next = (from + direction + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    setFilter(option.value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={copy.entity.label}
      className="inline-flex max-w-full items-center rounded-lg bg-muted p-0.5"
      onKeyDown={(event) => {
        const index = options.findIndex((option) => option.value === filter);
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(index, 1);
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(index, -1);
        }
      }}
    >
      {options.map((option, index) => {
        const selected = filter === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "h-11 min-w-11 shrink-0 rounded-md px-2 text-compact whitespace-nowrap",
              selected ? "bg-ink text-ink-foreground" : "text-foreground hover:bg-background/80",
            )}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
