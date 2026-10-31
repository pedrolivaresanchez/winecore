import { createHash } from 'node:crypto';
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
  nowMs: () => number = Date.now,
): TimbalAuth {
  const cache = new Map<string, { email: string; expiresAt: number }>();

  function remember(key: string, email: string, now: number): void {
    cache.delete(key);
    cache.set(key, { email, expiresAt: now + CACHE_TTL_MS });
    for (const [cached, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(cached);
    }
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }

  return {
    async emailFor(token: string): Promise<string | null> {
      const now = nowMs();
      const key = createHash('sha256').update(token, 'utf8').digest('hex');
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now) return hit.email;
      if (hit) cache.delete(key);

      // App sign-in tokens are project-scoped: /me?project_id= accepts them, while the org
      // management API (/orgs/{org}/projects/{project}) answers 403 to anyone who is not an org member.
      // The cache key is the hash of the token. The token itself is not stored or logged.
      const url = `https://${config.timbalApiHost}/me?project_id=${encodeURIComponent(config.timbalProjectId)}`;
      const response = await call(fetchImpl, url, { Authorization: `Bearer ${token}` });
      if (!response.ok) return null;
      const email = await readProjectSession(response, config.timbalProjectId);
      if (!email) return null;

      remember(key, email, now);
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

// Timbal answers { session: { user_email, ... }, project: { id, ... } }; a flat session is still accepted.
async function readProjectSession(response: Response, projectId: string): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return null;
    if ('project' in body && body.project && typeof body.project === 'object' && 'id' in body.project) {
      if (String(body.project.id) !== String(projectId)) return null;
    }
    const holder = 'session' in body && body.session && typeof body.session === 'object' ? body.session : body;
    if (!('user_email' in holder)) return null;
    const email = holder.user_email;
    if (typeof email !== 'string' || !email.includes('@')) return null;
    return email;
  } catch {
    return null;
  }
}
