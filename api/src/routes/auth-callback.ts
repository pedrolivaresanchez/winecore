/**
 * OAuth and magic-link landings.
 *
 * The UI host is a CloudFront distribution that only accepts cacheable methods
 * (GET and HEAD). A POST to `/login/callback` answers 403 "supports only cachable
 * requests". Timbal may deliver the session with POST (form) to `redirect_uri`.
 * That URI is therefore `/api/auth/callback`, which reaches this API. We answer
 * 303 so the browser continues with GET on the static app, tokens in the hash
 * (they are not sent to CloudFront and do not appear in the path log).
 */

const MAX_BODY = 16_384;
const MAX_TOKEN = 8_192;

export async function authCallback(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const access = tokenOf(url.searchParams.get('access_token'));
    const refresh = tokenOf(url.searchParams.get('refresh_token'));
    if (access && refresh) return seeOther(hashTarget(access, refresh));
    return seeOther('/login/callback');
  }

  const tokens = await tokensFromBody(request);
  if (!tokens) return seeOther('/login?error=auth_failed');
  return seeOther(hashTarget(tokens.access, tokens.refresh));
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function hashTarget(access: string, refresh: string): string {
  return `/login/callback#access_token=${encodeURIComponent(access)}&refresh_token=${encodeURIComponent(refresh)}`;
}

function tokenOf(value: string | null): string | null {
  if (!value) return null;
  const token = value.trim();
  if (token.length < 8 || token.length > MAX_TOKEN) return null;
  if (/[\r\n\s]/.test(token)) return null;
  return token;
}

async function tokensFromBody(request: Request): Promise<{ access: string; refresh: string } | null> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return null;
  const type = request.headers.get('content-type') ?? '';
  let access: string | null = null;
  let refresh: string | null = null;
  if (type.includes('application/json')) {
    try {
      const body = JSON.parse(raw) as { access_token?: unknown; refresh_token?: unknown };
      access = typeof body.access_token === 'string' ? tokenOf(body.access_token) : null;
      refresh = typeof body.refresh_token === 'string' ? tokenOf(body.refresh_token) : null;
    } catch {
      return null;
    }
  } else {
    const params = new URLSearchParams(raw);
    access = tokenOf(params.get('access_token'));
    refresh = tokenOf(params.get('refresh_token'));
  }
  if (!access || !refresh) return null;
  return { access, refresh };
}
