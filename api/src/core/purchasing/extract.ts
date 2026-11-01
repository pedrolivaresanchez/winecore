import { detectMime } from '../attachments/mime';
import { DomainError, domainError } from '../errors';
import { manualExtraction, parseSuppliedExtraction, type Extraction } from './extraction';
import { extractXmlInvoice } from './xml';

export const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

const OCR_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/heic']);

/**
 * El miembro de workforce no escribe en la base. Devuelve la extracción;
 * el núcleo crea el gasto. En pruebas se sustituye este borde.
 */
export interface OcrWorkforce {
  extract(input: { filename: string; mime: string; bytes: Uint8Array }): Promise<unknown>;
}

export const unavailableOcr: OcrWorkforce = {
  async extract() {
    throw domainError('WC_OCR_UNAVAILABLE');
  },
};

export interface Extractor {
  readonly id: 'xml' | 'timbal-ocr';
  supports(mime: string): boolean;
  extract(input: { bytes: Uint8Array; mime: string; filename: string }): Promise<Extraction>;
}

export class XmlInvoiceExtractor implements Extractor {
  readonly id = 'xml' as const;

  supports(mime: string): boolean {
    return mime === 'application/xml' || mime === 'text/xml';
  }

  extract(input: { bytes: Uint8Array; mime: string; filename: string }): Promise<Extraction> {
    return Promise.resolve(extractXmlInvoice(input.bytes));
  }
}

export class TimbalOcrExtractor implements Extractor {
  readonly id = 'timbal-ocr' as const;

  constructor(private readonly workforce: OcrWorkforce) {}

  supports(mime: string): boolean {
    return OCR_MIMES.has(mime);
  }

  async extract(input: { bytes: Uint8Array; mime: string; filename: string }): Promise<Extraction> {
    const result = await this.workforce.extract(input);
    const unwrapped = unwrapWorkforceResult(result);
    return parseSuppliedExtraction(unwrapped.extraction, unwrapped.model);
  }
}

export function unwrapWorkforceResult(value: unknown): { extraction: unknown; model: string | null } {
  if (value && typeof value === 'object' && 'extraction' in value) {
    const record = value as Record<string, unknown>;
    const model = typeof record.model === 'string' ? record.model : null;
    return { extraction: record.extraction, model };
  }
  return { extraction: value, model: null };
}

export async function extractDocument(
  file: { bytes: Uint8Array; filename: string },
  supplied: unknown | null,
  workforce: OcrWorkforce,
): Promise<Extraction> {
  if (file.bytes.byteLength === 0) {
    throw domainError('WC_VALIDATION', { file: 'El fichero está vacío' });
  }
  if (file.bytes.byteLength > MAX_CAPTURE_BYTES) {
    throw domainError('WC_VALIDATION', { file: 'El fichero supera el límite de 10 MB' });
  }
  const mime = detectMime(file.bytes);
  if (!mime) throw domainError('WC_VALIDATION', { file: 'Tipo de fichero no admitido' });
  const xml = new XmlInvoiceExtractor();
  if (xml.supports(mime)) return xml.extract({ bytes: file.bytes, mime, filename: file.filename });
  const ocr = new TimbalOcrExtractor(workforce);
  if (!ocr.supports(mime)) throw domainError('WC_VALIDATION', { file: 'Tipo de fichero no admitido' });
  if (supplied != null) return parseSuppliedExtraction(supplied, modelOf(supplied));
  try {
    return await ocr.extract({ bytes: file.bytes, mime, filename: file.filename });
  } catch (error) {
    // Sin OCR (sin configurar o caído) el documento se guarda igual: perderlo obligaría a subirlo otra vez.
    if (error instanceof DomainError && error.code === 'WC_OCR_UNAVAILABLE') return manualExtraction();
    throw error;
  }
}

function modelOf(supplied: unknown): string | null {
  return unwrapWorkforceResult(supplied).model;
}

export function sourceFor(mime: string, requested: string | null): 'upload' | 'photo' | 'email_forward' {
  if (requested === 'email_forward') return 'email_forward';
  if (requested === 'photo' || requested === 'upload') return requested;
  return mime.startsWith('image/') ? 'photo' : 'upload';
}

export function attachmentRole(source: 'upload' | 'photo' | 'email_forward'): 'supplier_invoice_scan' | 'expense_photo' {
  return source === 'photo' ? 'expense_photo' : 'supplier_invoice_scan';
}
