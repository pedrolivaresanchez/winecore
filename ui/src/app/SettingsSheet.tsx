import { useMemo, useState } from "react";
import { Building2, ChevronLeft, Gauge } from "lucide-react";
import { EntityRoles } from "@/components/EntityRoles";
import { SystemStatus } from "@/components/SystemStatus";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { copy } from "@/i18n";
import type { Me } from "@/lib/types";

type Category = {
  id: "entities" | "system";
  title: string;
  hint: string;
  keywords: string;
};

const categories: Category[] = [
  { id: "entities", title: copy.settings.entities, hint: copy.settings.entitiesHint, keywords: "entidades usuarios roles bodega" },
  { id: "system", title: copy.settings.system, hint: copy.settings.systemHint, keywords: "sistema version esquema base datos escritor" },
];

export function SettingsSheet({ me, open, onOpenChange }: { me: Me; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Category["id"] | null>(null);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    if (!needle) return categories;
    return categories.filter((category) => `${category.title} ${category.hint} ${category.keywords}`.toLocaleLowerCase("es").includes(needle));
  }, [query]);
  const current = categories.find((category) => category.id === selected) ?? null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected(null);
        onOpenChange(next);
      }}
    >
      <SheetContent data-screen="ajustes">
        <SheetHeader>
          {current ? (
            <button
              type="button"
              className="mb-1 inline-flex min-h-11 items-center gap-1 self-start text-compact text-muted-foreground"
              onClick={() => setSelected(null)}
            >
              <ChevronLeft aria-hidden className="size-4" />
              {copy.settings.back}
            </button>
          ) : null}
          <SheetTitle>{current?.title ?? copy.settings.title}</SheetTitle>
          <SheetDescription>{current?.hint ?? "Elige un apartado."}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {current?.id === "entities" ? <EntityRoles me={me} /> : null}
          {current?.id === "system" ? <SystemStatus /> : null}
          {current ? null : (
            <>
              <label className="sr-only" htmlFor="ajustes-buscar">
                {copy.settings.search}
              </label>
              <Input
                id="ajustes-buscar"
                type="search"
                value={query}
                placeholder={copy.settings.search}
                onChange={(event) => setQuery(event.target.value)}
              />
              {visible.length === 0 ? (
                <p className="mt-4 text-compact text-muted-foreground">{copy.settings.empty}</p>
              ) : (
                <ul className="mt-4 grid grid-cols-2 gap-3">
                  {visible.map((category) => {
                    const Icon = category.id === "entities" ? Building2 : Gauge;
                    return (
                      <li key={category.id}>
                        <button
                          type="button"
                          className="flex min-h-28 w-full flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left hover:bg-accent"
                          onClick={() => setSelected(category.id)}
                        >
                          <Icon aria-hidden className="size-5" />
                          <span className="text-compact font-medium">{category.title}</span>
                          <span className="text-meta text-muted-foreground">{category.hint}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
