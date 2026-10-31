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
import { NoAccess } from "@/pages/NoAccess";
import { NotFound } from "@/pages/NotFound";
import { Panel } from "@/pages/Panel";
import { ContactCreate } from "@/pages/contactos/ContactCreate";
import { ContactList } from "@/pages/contactos/ContactList";
import { ContactPage } from "@/pages/contactos/ContactPage";
import { PriceListPage } from "@/pages/catalogo/PriceListPage";
import { PriceListsPage } from "@/pages/catalogo/PriceListsPage";
import { ProductList } from "@/pages/catalogo/ProductList";
import { ProductPage } from "@/pages/catalogo/ProductPage";
import { WinesPage } from "@/pages/catalogo/WinesPage";

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
          <Route path="contactos" element={<ContactList me={me.data} />} />
          <Route path="contactos/nuevo" element={<ContactCreate me={me.data} />} />
          <Route path="contactos/:id" element={<ContactPage me={me.data} />} />
          <Route path="catalogo" element={<ProductList me={me.data} />} />
          <Route path="catalogo/vinos" element={<WinesPage me={me.data} />} />
          <Route path="catalogo/tarifas" element={<PriceListsPage me={me.data} />} />
          <Route path="catalogo/tarifas/:id" element={<PriceListPage me={me.data} />} />
          <Route path="catalogo/:id" element={<ProductPage me={me.data} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Shell>
    </EntityProvider>
  );
}
