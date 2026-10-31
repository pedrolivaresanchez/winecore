import type { Config } from '../../../config';
import { domainError } from '../../errors';

export interface OutboundMail {
  to: readonly string[];
  subject: string;
  text: string;
  attachments: readonly {
    filename: string;
    mime: string;
    bytes: Uint8Array;
  }[];
}

/**
 * Send-only. There is no method that reads a mailbox: agents stay read-only,
 * and this provider is not called unless a person confirms the send.
 */
export interface MailProvider {
  readonly enabled: boolean;
  readonly sender: string;
  send(message: OutboundMail): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const disabledMailProvider: MailProvider = {
  enabled: false,
  sender: '',
  async send() {
    throw domainError('WC_MAIL_DISABLED');
  },
};

export function mailProviderFromConfig(config: Config, fetchImpl?: FetchLike): MailProvider {
  if (!config.outboundMail.enabled) return disabledMailProvider;
  return createGraphMailProvider(config.outboundMail, fetchImpl ?? fetch);
}

export function createGraphMailProvider(
  settings: { tenantId: string; clientId: string; clientSecret: string; sender: string },
  fetchImpl: FetchLike,
): MailProvider {
  return {
    enabled: true,
    sender: settings.sender,
    async send(message) {
      const token = await accessToken(settings, fetchImpl);
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(settings.sender)}/sendMail`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: { contentType: 'Text', content: message.text },
              toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
              attachments: message.attachments.map((file) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: file.filename,
                contentType: file.mime,
                contentBytes: Buffer.from(file.bytes).toString('base64'),
              })),
            },
            saveToSentItems: true,
          }),
        });
      } catch {
        throw domainError('WC_MAIL_FAILED');
      }
      if (!response.ok) {
        await response.arrayBuffer().catch(() => undefined);
        throw domainError('WC_MAIL_FAILED', undefined, { status: response.status });
      }
      await response.arrayBuffer().catch(() => undefined);
    },
  };
}

async function accessToken(
  settings: { tenantId: string; clientId: string; clientSecret: string },
  fetchImpl: FetchLike,
): Promise<string> {
  const url = `https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/token`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
  } catch {
    throw domainError('WC_MAIL_FAILED');
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw domainError('WC_MAIL_FAILED', undefined, { status: response.status });
  }
  const payload = await response.json() as { access_token?: unknown };
  if (typeof payload.access_token !== 'string' || payload.access_token === '') {
    throw domainError('WC_MAIL_FAILED');
  }
  return payload.access_token;
}
