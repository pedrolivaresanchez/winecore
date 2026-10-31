import { Route, Routes } from "react-router-dom";
import { EntityProvider } from "@/app/entity-context";
import { Shell } from "@/app/Shell";
import { ErrorState } from "@/components/ErrorState";
import { BrandMark } from "@/components/BrandMark";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { useNoAccess } from "@/hooks/use-no-access";
import { copy } from "@/i18n";
import type { Me } from "@/lib/types";
import { Contactos } from "@/pages/Contactos";
import { Mas } from "@/pages/Mas";
import { NoAccess } from "@/pages/NoAccess";
import { NotFound } from "@/pages/NotFound";
import { Panel } from "@/pages/Panel";

function LoadingScreen() {
  return (
    <div className="min-h-dvh bg-background px-4 py-5" data-screen="cargando" aria-busy="true">
      <p className="sr-only">{copy.loading}</p>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-6 h-40 w-full max-w-[1280px]" />
    </div>
  );
}

export function Workspace() {
  const denied = useNoAccess();
  const me = useApi<Me>("/v1/me");

  if (denied) return <NoAccess />;

  if (me.loading && !me.data) return <LoadingScreen />;

  if (me.error || !me.data) {
    const error = me.error;
    return (
      <main
        data-screen="error"
        className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4"
      >
        <BrandMark word="always" />
        <ErrorState
          title={`${copy.error.load} (${error?.code ?? "WC_ERROR"})`}
          detail={error?.message}
          onRetry={me.reload}
        />
      </main>
    );
  }

  return (
    <EntityProvider me={me.data}>
      <Shell me={me.data}>
        <Routes>
          <Route index element={<Panel me={me.data} />} />
          <Route path="contactos" element={<Contactos />} />
          <Route path="mas" element={<Mas />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </EntityProvider>
  );
}
