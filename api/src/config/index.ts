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
  /** Outbound invoice mail. Disabled until Q-014 is configured. Never reads a mailbox. */
  outboundMail: OutboundMailConfig;
}

export interface OutboundMailConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
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

  const gitSha = read(env, 'GIT_SHA') ?? 'dev';
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(gitSha)) invalid('GIT_SHA');

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
    outboundMail: outboundMail(env),
  };
}

const DISABLED_MAIL: OutboundMailConfig = {
  enabled: false,
  tenantId: '',
  clientId: '',
  clientSecret: '',
  sender: '',
};

/** Graph is off unless the provider and the four mailbox settings are present and well formed. */
function outboundMail(env: Env): OutboundMailConfig {
  const provider = read(env, 'WINECORE_MAIL_PROVIDER') ?? 'none';
  if (provider === 'none') return DISABLED_MAIL;
  if (provider !== 'graph') invalid('WINECORE_MAIL_PROVIDER');

  const tenantId = read(env, 'WINECORE_GRAPH_TENANT_ID') ?? '';
  const clientId = read(env, 'WINECORE_GRAPH_CLIENT_ID') ?? '';
  const clientSecret = read(env, 'WINECORE_GRAPH_CLIENT_SECRET') ?? '';
  const sender = read(env, 'WINECORE_GRAPH_SENDER') ?? '';
  if (tenantId === '' || clientId === '' || clientSecret === '' || sender === '') return DISABLED_MAIL;
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(tenantId) || tenantId.includes('..')) {
    invalid('WINECORE_GRAPH_TENANT_ID');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(clientId)) invalid('WINECORE_GRAPH_CLIENT_ID');
  if (clientSecret.length > 512 || /[\r\n]/.test(clientSecret)) invalid('WINECORE_GRAPH_CLIENT_SECRET');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender)) invalid('WINECORE_GRAPH_SENDER');
  return { enabled: true, tenantId, clientId, clientSecret, sender };
}
