import { useState, type ReactNode } from "react";
import { BottomNav } from "@/app/BottomNav";
import { Header } from "@/app/Header";
import { Sidebar } from "@/app/Sidebar";
import { copy } from "@/i18n";
import { useMinWidth } from "@/hooks/use-media";
import { readStorage, SIDEBAR_KEY, writeStorage } from "@/lib/storage";
import type { Me } from "@/lib/types";

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const desktop = useMinWidth(1024);
  const [prefCollapsed, setPrefCollapsed] = useState(() => readStorage(SIDEBAR_KEY) === "collapsed");
  const collapsed = desktop ? prefCollapsed : true;

  function toggleCollapsed() {
    setPrefCollapsed((current) => {
      const next = !current;
      writeStorage(SIDEBAR_KEY, next ? "collapsed" : "expanded");
      return next;
    });
  }

  return (
    <div className="flex min-h-dvh bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        {copy.skip}
      </a>
      <Sidebar collapsed={collapsed} showToggle={desktop} onToggle={toggleCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header me={me} />
        <main
          id="contenido"
          className="flex-1 px-4 pt-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pt-6 md:pb-8"
        >
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">{children}</div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
