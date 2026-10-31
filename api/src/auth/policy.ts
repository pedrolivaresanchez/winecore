import type { Config } from '../config';

/** Dev login exists only outside production. A production process never honors `x-dev-user`. */
export function devAuthEnabled(config: Pick<Config, 'authMode' | 'nodeEnv'>): boolean {
  return config.authMode === 'dev' && config.nodeEnv !== 'production';
}

/**
 * Browser origins that may call the API with credentials.
 * Production allows the configured deployment origin only.
 * Any other environment also allows localhost and 127.0.0.1.
 */
export function isAllowedOrigin(
  config: Pick<Config, 'nodeEnv' | 'appPublicUrl' | 'webauthnOrigin'>,
  origin: string,
): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (configuredOrigins(config).has(url.origin)) return true;
  if (config.nodeEnv === 'production') return false;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return local && (url.protocol === 'http:' || url.protocol === 'https:');
}

function configuredOrigins(config: Pick<Config, 'appPublicUrl' | 'webauthnOrigin'>): Set<string> {
  const origins = new Set<string>();
  for (const value of [config.appPublicUrl, config.webauthnOrigin]) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      // loadConfig already rejects a deployment origin it cannot parse.
    }
  }
  return origins;
}

export function securityHeaders(nodeEnv: string): Record<string, string> {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  };
  if (nodeEnv === 'production') {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}
