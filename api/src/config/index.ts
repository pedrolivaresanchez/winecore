export type Env = Record<string, string | undefined>;

export type DbMode = 'local' | 'timbal';
export type AuthMode = 'timbal' | 'dev';

export interface Config {
  port: number;
  nodeEnv: string;
  apiBasePath: string;
  dbMode: DbMode;
  dbPath: string;
  timbalApiHost: string;
  timbalOrgId: string;
  timbalProjectId: string;
  timbalKbId: string;
  timbalToken: string;
  authMode: AuthMode;
  devUserEmail: string;
  gitSha: string;
  cvbotEventsUrl: string | null;
  cvbotEventsHmacKey: string | null;
  /** Relying party id (host, sin puerto). `localhost` en desarrollo. */
  webauthnRpId: string;
  /** Origen de la UI, p. ej. `http://localhost:5173`. */
  webauthnOrigin: string;
  webauthnRpName: string;
  /** AES-256 para secretos TOTP. Nulo si falta en desarrollo; obligatorio en producción. */
  dataKey: Uint8Array | null;
  /** Public origin of the web app. QR labels point at `${appPublicUrl}/q/{token}`. */
  appPublicUrl: string;
}

function invalid(name: string): never {
  throw new Error(`Variable ausente o inválida: ${name}`);
}

function read(env: Env, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  if (value.includes('\0')) invalid(name);
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function loadConfig(env: Env): Config {
  const nodeEnv = read(env, 'NODE_ENV') ?? invalid('NODE_ENV');
  if (!/^[A-Za-z0-9._-]+$/.test(nodeEnv)) invalid('NODE_ENV');

  const portRaw = env.PORT;
  let port = 3000;
  if (portRaw !== undefined && portRaw !== '') {
    if (!/^\d+$/.test(portRaw)) invalid('PORT');
    port = Number(portRaw);
    if (port < 1 || port > 65535) invalid('PORT');
  }

  const apiBasePath = read(env, 'API_BASE_PATH') ?? '';
  if (apiBasePath !== '' && !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(apiBasePath)) {
    invalid('API_BASE_PATH');
  }

  const dbModeRaw = read(env, 'DB_MODE') ?? 'local';
  if (dbModeRaw !== 'local' && dbModeRaw !== 'timbal') invalid('DB_MODE');
  const dbMode: DbMode = dbModeRaw;

  const dbPath = read(env, 'DB_PATH') ?? '.data/winecore.duckdb';
  if (dbPath.length > 512) invalid('DB_PATH');

  const timbalApiHost = read(env, 'TIMBAL_API_HOST') ?? 'api.timbal.ai';
  if (
    timbalApiHost.includes('://') ||
    timbalApiHost.includes('/') ||
    /\s/.test(timbalApiHost) ||
    timbalApiHost.length > 253
  ) {
    invalid('TIMBAL_API_HOST');
  }

  const authModeRaw = read(env, 'AUTH_MODE') ?? invalid('AUTH_MODE');
  if (authModeRaw !== 'timbal' && authModeRaw !== 'dev') invalid('AUTH_MODE');
  if (authModeRaw === 'dev' && nodeEnv === 'production') invalid('AUTH_MODE');
  const authMode: AuthMode = authModeRaw;

  const devUserEmail = read(env, 'DEV_USER_EMAIL') ?? 'owner@winecore.test';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(devUserEmail)) invalid('DEV_USER_EMAIL');

  const platformRev = read(env, 'TIMBAL_PROJECT_REV');
  const gitSha = read(env, 'GIT_SHA') ?? (platformRev && /^[A-Za-z0-9._:-]{1,80}$/.test(platformRev) ? platformRev : 'dev');
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(gitSha)) invalid('GIT_SHA');

  const appPublicUrl = (read(env, 'APP_PUBLIC_URL') ?? 'http://localhost:5173').replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9._~:-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/.test(appPublicUrl)) {
    invalid('APP_PUBLIC_URL');
  }

  const needsOrg = dbMode === 'timbal' || authMode === 'timbal';
  const timbalOrgId = read(env, 'TIMBAL_ORG_ID') ?? (needsOrg ? invalid('TIMBAL_ORG_ID') : '');
  const timbalProjectId =
    read(env, 'TIMBAL_PROJECT_ID') ?? (authMode === 'timbal' ? invalid('TIMBAL_PROJECT_ID') : '');
  const timbalKbId = read(env, 'TIMBAL_KB_ID') ?? (dbMode === 'timbal' ? invalid('TIMBAL_KB_ID') : '');
  const token = read(env, 'TIMBAL_PROJECT_SECRET') ?? read(env, 'TIMBAL_API_KEY') ?? '';
  if (dbMode === 'timbal' && token === '') invalid('TIMBAL_PROJECT_SECRET o TIMBAL_API_KEY');

  for (const [name, value] of [
    ['TIMBAL_ORG_ID', timbalOrgId],
    ['TIMBAL_PROJECT_ID', timbalProjectId],
    ['TIMBAL_KB_ID', timbalKbId],
  ] as const) {
    if (value !== '' && !/^[A-Za-z0-9._~:-]{1,128}$/.test(value)) invalid(name);
  }

  const devLike = nodeEnv !== 'production';
  const webauthnRpId = read(env, 'WEBAUTHN_RP_ID') ?? (devLike ? 'localhost' : invalid('WEBAUTHN_RP_ID'));
  const webauthnOrigin = read(env, 'WEBAUTHN_ORIGIN') ?? (devLike ? 'http://localhost:5173' : invalid('WEBAUTHN_ORIGIN'));
  if (!validRpId(webauthnRpId)) invalid('WEBAUTHN_RP_ID');
  if (!validOrigin(webauthnOrigin, nodeEnv) || !originMatchesRp(webauthnOrigin, webauthnRpId)) {
    invalid('WEBAUTHN_ORIGIN');
  }

  const dataKeyRaw = read(env, 'WINECORE_DATA_KEY');
  let dataKey: Uint8Array | null = null;
  if (dataKeyRaw === undefined) {
    if (!devLike) invalid('WINECORE_DATA_KEY');
  } else {
    dataKey = parseAes256Key(dataKeyRaw);
    if (!dataKey) invalid('WINECORE_DATA_KEY');
  }

  return {
    port,
    nodeEnv,
    apiBasePath,
    dbMode,
    dbPath,
    timbalApiHost,
    timbalOrgId,
    timbalProjectId,
    timbalKbId,
    timbalToken: token,
    authMode,
    devUserEmail,
    gitSha,
    cvbotEventsUrl: readHttpUrl(env, 'CVBOT_EVENTS_URL'),
    cvbotEventsHmacKey: readSecret(env, 'CVBOT_EVENTS_HMAC_KEY'),
    webauthnRpId,
    webauthnOrigin,
    webauthnRpName: 'WineCore',
    dataKey,
    appPublicUrl,
  };
}

function readHttpUrl(env: Env, name: string): string | null {
  const value = read(env, name);
  if (value === undefined) return null;
  if (value.length > 300) invalid(name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid(name);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') invalid(name);
  if (parsed.username !== '' || parsed.password !== '') invalid(name);
  return value;
}

function readSecret(env: Env, name: string): string | null {
  const value = read(env, name);
  if (value === undefined) return null;
  if (value.length > 512) invalid(name);
  return value;
}

function validRpId(value: string): boolean {
  if (value.length > 253 || value.includes('..')) return false;
  if (value === 'localhost') return true;
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value);
}

function validOrigin(value: string, nodeEnv: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== '/' && url.pathname !== '') return false;
  if (nodeEnv === 'production' && url.protocol !== 'https:') return false;
  return url.protocol === 'https:' || url.protocol === 'http:';
}

function originMatchesRp(origin: string, rpId: string): boolean {
  const host = new URL(origin).hostname;
  return host === rpId || host.endsWith(`.${rpId}`);
}

function parseAes256Key(value: string): Uint8Array | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const out = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) {
      out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
  }
  if (!/^[A-Za-z0-9+/_=-]{43,48}$/.test(value)) return null;
  const encoding = value.includes('+') || value.includes('/') ? 'base64' : 'base64url';
  const bytes = Buffer.from(value, encoding);
  return bytes.length === 32 ? new Uint8Array(bytes) : null;
}
