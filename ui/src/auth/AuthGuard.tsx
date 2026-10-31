import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { isAuthEnabled, useSession } from "@/auth/provider";
import { copy } from "@/i18n";

export function AuthGuard({ children, requireAuth = false }: { children: ReactNode; requireAuth?: boolean }) {
  const { isAuthenticated, loading } = useSession();

  if (!isAuthEnabled) return children;

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6" data-screen="entrando" aria-busy="true">
        <p className="text-body text-muted-foreground">{copy.login.callback}</p>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) return <Navigate to="/login" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;
  return children;
}
