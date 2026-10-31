/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  authConfig,
  isAuthEnabled,
  isOAuthProviderEnabled,
  type OAuthProvider,
} from "@/auth/config";
import {
  AccessDeniedError,
  clearTokens,
  getAccessToken,
  getOAuthUrl,
  getRefreshToken,
  refreshAccessToken,
  requestMagicLink,
  setTokens,
  validateUser,
  type TimbalUser,
} from "@/auth/tokens";

export type { OAuthProvider };
export { authConfig, isAuthEnabled, isOAuthProviderEnabled, AccessDeniedError };

interface SessionContextType {
  user: TimbalUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  setUserFromCallback: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession debe usarse dentro de SessionProvider");
  return context;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TimbalUser | null>(null);
  const [loading, setLoading] = useState(isAuthEnabled);

  useEffect(() => {
    if (!isAuthEnabled) return;

    let cancelled = false;
    const restore = async () => {
      try {
        const existing = getAccessToken();
        if (existing) {
          const next = await validateUser(existing, authConfig.orgId, authConfig.projectId);
          if (!cancelled) setUser(next);
          return;
        }
        if (getRefreshToken() && (await refreshAccessToken())) {
          const token = getAccessToken();
          if (!token) return;
          const next = await validateUser(token, authConfig.orgId, authConfig.projectId);
          if (!cancelled) setUser(next);
          return;
        }
      } catch {
        clearTokens();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const setUserFromCallback = useCallback(async (nextAccess: string, nextRefresh: string) => {
    setTokens(nextAccess, nextRefresh);
    const next = await validateUser(nextAccess, authConfig.orgId, authConfig.projectId);
    setUser(next);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: user !== null,
        setUserFromCallback,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useAuth() {
  return {
    loginWithOAuth: (provider: OAuthProvider) => {
      window.location.assign(getOAuthUrl(provider));
    },
    sendMagicLink: (email: string) => requestMagicLink(email),
    isAuthEnabled,
    config: authConfig,
    isOAuthProviderEnabled,
  };
}
