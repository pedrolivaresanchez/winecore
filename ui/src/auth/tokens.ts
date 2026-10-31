import { authConfig } from "@/auth/config";

const REFRESH_TOKEN_KEY = "timbal_refresh_token";

let accessToken: string | null = null;

function readStoredRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

let refreshToken: string | null = readStoredRefresh();

export const getAccessToken = () => accessToken;
export const getRefreshToken = () => refreshToken;

export const setTokens = (access: string, refresh: string) => {
  accessToken = access;
  refreshToken = refresh;
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  } catch {
    /* La sesión en memoria sigue valiendo hasta recargar. */
  }
};

export const clearTokens = () => {
  accessToken = null;
  refreshToken = null;
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* Nada que hacer si el almacenamiento está bloqueado. */
  }
};

let refreshPromise: Promise<boolean> | null = null;

export const refreshAccessToken = async (): Promise<boolean> => {
  if (!refreshToken) return false;
  if (refreshPromise) return refreshPromise;

  const current = refreshToken;
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${authConfig.timbalBaseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: current,
        }),
      });
      if (!response.ok) {
        clearTokens();
        return false;
      }
      const data = (await response.json()) as { access_token?: string; refresh_token?: string };
      if (!data.access_token) {
        clearTokens();
        return false;
      }
      accessToken = data.access_token;
      if (data.refresh_token) {
        refreshToken = data.refresh_token;
        try {
          localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        } catch {
          /* El token nuevo queda en memoria. */
        }
      }
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

export class AccessDeniedError extends Error {
  constructor(message = "No tienes acceso a esta aplicación") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export type TimbalUser = Record<string, unknown>;

export const fetchCurrentUser = async (token?: string): Promise<TimbalUser | null> => {
  const current = token ?? accessToken;
  if (!current) return null;
  try {
    const response = await fetch(`${authConfig.timbalBaseUrl}/me`, {
      headers: { Authorization: `Bearer ${current}` },
    });
    if (!response.ok) return null;
    return (await response.json()) as TimbalUser;
  } catch {
    return null;
  }
};

// App sign-in tokens are project-scoped: /me?project_id= validates them. The org management API
// (/orgs/{org}/projects/{project}) answers 403 to anyone who is not a member of the organization.
export const validateUser = async (token: string, _orgId?: string, projectId?: string): Promise<TimbalUser> => {
  const url = projectId
    ? `${authConfig.timbalBaseUrl}/me?project_id=${encodeURIComponent(projectId)}`
    : `${authConfig.timbalBaseUrl}/me`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 403 || response.status === 404) throw new AccessDeniedError();
  if (!response.ok) throw new Error("La sesión no es válida");
  const body = (await response.json()) as { session?: TimbalUser; project?: { id?: unknown } };
  if (projectId && body.project && String(body.project.id) !== String(projectId)) throw new AccessDeniedError();
  return body.session ?? (body as TimbalUser);
};

export const requestMagicLink = async (email: string): Promise<void> => {
  const response = await fetch(`${authConfig.timbalBaseUrl}/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      redirect_uri: `${window.location.origin}/login/callback`,
    }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string; detail?: string };
    throw new Error(data.message ?? data.detail ?? "No se pudo enviar el enlace");
  }
};

export const getOAuthUrl = (provider: string): string => {
  const redirectUri = `${window.location.origin}/login/callback`;
  const url = new URL(`${authConfig.timbalBaseUrl}/oauth/authorize`);
  url.searchParams.set("provider", provider);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
};
