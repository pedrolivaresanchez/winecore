import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function SlideOver({
  open,
  onOpenChange,
  title,
  description,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  children,
  screen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onPrev?: () => void;
  onNext?: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  children: ReactNode;
  screen?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0" data-screen={screen}>
        <SheetHeader className="border-b pb-3">
          <SheetTitle className="text-balance">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
          {onPrev || onNext ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-compact hover:bg-accent disabled:opacity-40"
                onClick={onPrev}
                disabled={prevDisabled}
              >
                <ChevronLeft aria-hidden className="size-4" />
                Anterior
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-compact hover:bg-accent disabled:opacity-40"
                onClick={onNext}
                disabled={nextDisabled}
              >
                Siguiente
                <ChevronRight aria-hidden className="size-4" />
              </button>
            </div>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
