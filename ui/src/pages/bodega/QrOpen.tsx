import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";

type Resolved = { code: string };

export function QrOpen({ me }: { me: Me }) {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const path = allows(me, "cellar.read") && token ? `/v1/vessels/qr/${encodeURIComponent(token)}` : null;
  const data = useApi<Resolved>(path);

  useEffect(() => {
    if (data.data?.code) navigate(`/bodega/${encodeURIComponent(data.data.code)}`, { replace: true });
  }, [data.data?.code, navigate]);

  if (!allows(me, "cellar.read")) return <NoPermission />;
  if (data.error) {
    return <ErrorState title={`No se ha podido abrir el QR (${data.error.code})`} detail={data.error.message} onRetry={data.reload} />;
  }
  return (
    <div aria-busy="true" className="grid gap-3" data-screen="bodega-qr-abierto">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36" />
    </div>
  );
}
