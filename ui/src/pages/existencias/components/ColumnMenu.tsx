import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ColumnMenu({
  ids,
  labels,
  hidden,
  locked,
  onToggle,
}: {
  ids: readonly string[];
  labels: Record<string, string>;
  hidden: Set<string>;
  locked?: string;
  onToggle: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="md" className="hidden md:inline-flex">
          <Columns3 aria-hidden className="size-4" />
          Columnas
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ids.map((id) => (
          <DropdownMenuItem
            key={id}
            className="min-h-11"
            disabled={id === locked}
            onSelect={(event) => {
              event.preventDefault();
              onToggle(id);
            }}
          >
            <input type="checkbox" readOnly checked={!hidden.has(id)} className="size-4" aria-hidden />
            {labels[id]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
