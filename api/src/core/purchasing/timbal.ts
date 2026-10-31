import { domainError } from '../errors';
import { unavailableOcr, unwrapWorkforceResult, type OcrWorkforce } from './extract';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Llama al workflow `ocr-gastos` y se queda con la extracción.
 * `api_base_url` vacío: el miembro no vuelve a crear el gasto (lo crea este proceso).
 * Si el miembro se arranca en Timbal con `WINECORE_API_URL`, él mismo hace el POST.
 */
export function timbalOcrWorkforce(options: {
  url: string;
  token?: string;
  fetchImpl?: FetchLike;
}): OcrWorkforce {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async extract(input) {
      const headers = new Headers({ 'content-type': 'application/json' });
      if (options.token) headers.set('authorization', `Bearer ${options.token}`);
      let response: Response;
      try {
        response = await fetchImpl(options.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filename: input.filename,
            content_base64: Buffer.from(input.bytes).toString('base64'),
            source: input.mime.startsWith('image/') ? 'photo' : 'upload',
            api_base_url: '',
          }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw domainError('WC_OCR_UNAVAILABLE');
      }
      if (!response.ok) throw domainError('WC_OCR_UNAVAILABLE');
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw domainError('WC_OCR_UNAVAILABLE');
      }
      const unwrapped = unwrapWorkforceResult(body);
      const routed = response.headers.get('x-timbal-routed-model');
      return {
        extraction: unwrapped.extraction,
        model: routed && routed.trim() !== '' ? routed.trim() : unwrapped.model ?? 'timbal/auto',
      };
    },
  };
}

export function ocrFromEnv(env: Record<string, string | undefined> = process.env): OcrWorkforce {
  const url = env.WINECORE_OCR_URL?.trim() ?? '';
  if (!/^https?:\/\//.test(url)) return unavailableOcr;
  const token = env.WINECORE_OCR_TOKEN?.trim();
  return timbalOcrWorkforce({ url, token: token || undefined });
}
