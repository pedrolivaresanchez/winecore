import type { Config } from '../config';
import type { FetchLike } from '../core/db/timbal';

export interface TimbalAuth {
  emailFor(token: string): Promise<string | null>;
}

const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 500;

export function createTimbalAuth(
  config: Pick<Config, 'timbalApiHost' | 'timbalOrgId' | 'timbalProjectId'>,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): TimbalAuth {
  const cache = new Map<string, { email: string; expiresAt: number }>();

  return {
    async emailFor(token: string): Promise<string | null> {
      const hit = cache.get(token);
      if (hit && hit.expiresAt > Date.now()) return hit.email;

      const headers = { Authorization: `Bearer ${token}` };
      const meUrl = `https://${config.timbalApiHost}/me`;
      const projectUrl = `https://${config.timbalApiHost}/orgs/${config.timbalOrgId}/projects/${config.timbalProjectId}`;

      const meResponse = await call(fetchImpl, meUrl, headers);
      if (!meResponse.ok) return null;
      const email = await readEmail(meResponse);
      if (!email) return null;

      const projectResponse = await call(fetchImpl, projectUrl, headers);
      if (!projectResponse.ok) return null;

      cache.set(token, { email, expiresAt: Date.now() + CACHE_TTL_MS });
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      return email;
    },
  };
}

async function call(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetchImpl(url, { headers });
  } catch {
    throw new Error('No se ha podido validar la sesión');
  }
}

// Timbal's /me answers { session: { user_email, ... } }; the flat shape is still accepted.
async function readEmail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    const holder = 'session' in body && body.session && typeof body.session === 'object' ? body.session : body;
    if (!('user_email' in holder)) return null;
    const email = holder.user_email;
    if (typeof email !== 'string' || !email.includes('@')) return null;
    return email;
  } catch {
    return null;
  }
}
