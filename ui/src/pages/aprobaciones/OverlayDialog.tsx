import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function OverlayDialog({
  open,
  title,
  titleId,
  screen,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  titleId: string;
  screen: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = panelRef.current;
    const target = node?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select");
    target?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[70] flex items-end justify-center bg-foreground/40 sm:items-center sm:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-screen={screen}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-card p-4 card-shadow sm:max-w-md sm:rounded-xl"
      >
        <h2 id={titleId} className="pr-2 text-body font-semibold">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
