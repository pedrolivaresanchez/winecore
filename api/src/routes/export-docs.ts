import { requestIdFor, sessionOf } from '../auth/guard';
import { buildCommercialInvoice, buildPackingList } from '../core/billing/export/documents';
import { parseExportInvoice } from '../core/billing/export/parse';
import { renderPdf } from '../core/billing/export/pdf';
import { assessExport } from '../core/billing/export/readiness';
import { readExportDocuments, saveExportDocuments } from '../core/billing/export/store';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';

export function getExportDocuments(writer: Writer) {
  return readExportDocuments(writer);
}

export async function putExportDocuments(writer: Writer, request: Request) {
  const user = sessionOf(request);
  return saveExportDocuments(
    writer,
    {
      type: 'user',
      id: user.id,
      requestId: requestIdFor(request),
      reason: 'ajuste de documentos de exportación',
    },
    await readJson(request),
    request.headers.get('if-match'),
  );
}

export async function postExportReadiness(writer: Writer, request: Request) {
  const assessment = await assess(writer, request);
  return {
    ready: assessment.ready,
    confirmation_required: assessment.confirmation_required,
    example: assessment.example,
    confirmed: assessment.confirmed,
    notice: assessment.notice,
    destination_country: assessment.destination_country,
    entity_eori_missing: assessment.entity_eori_missing,
    missing: assessment.missing,
  };
}

export async function postExportChecklist(writer: Writer, request: Request) {
  const assessment = await assess(writer, request);
  return {
    ready: assessment.ready,
    confirmation_required: assessment.confirmation_required,
    example: assessment.example,
    confirmed: assessment.confirmed,
    notice: assessment.notice,
    notes: assessment.notes,
    destination_country: assessment.destination_country,
    items: assessment.items,
  };
}

export async function postExportDocuments(writer: Writer, request: Request) {
  const invoice = parseExportInvoice(await readJson(request));
  const stored = await readExportDocuments(writer);
  const assessment = assessExport(invoice, stored.value);
  if (!assessment.ready) {
    throw domainError(
      assessment.entity_eori_missing ? 'WC_INV_ENTITY_EORI_REQUIRED' : 'WC_EXPORT_NOT_READY',
      undefined,
      { missing: assessment.missing },
    );
  }
  const country = stored.value.countries[invoice.destination_country];
  if (!country) throw domainError('WC_EXPORT_NOT_READY', undefined, { missing: assessment.missing });
  const commercialWanted = assessment.items.some((item) => item.code === 'commercial_invoice' && item.status === 'generated');
  const packingWanted = assessment.items.some((item) => item.code === 'packing_list' && item.status === 'generated');
  const commercial = commercialWanted ? buildCommercialInvoice(invoice, country) : null;
  const packing = packingWanted ? buildPackingList(invoice, country) : null;
  const [commercialPdf, packingPdf] = await Promise.all([
    commercial ? renderPdf(commercial.text) : Promise.resolve(null),
    packing ? renderPdf(packing.text) : Promise.resolve(null),
  ]);
  return {
    ready: true,
    confirmation_required: assessment.confirmation_required,
    example: assessment.example,
    confirmed: assessment.confirmed,
    notice: assessment.notice,
    checklist: assessment.items,
    commercial_invoice: commercial && commercialPdf
      ? { document: commercial.document, text: commercial.text, pdf_base64: Buffer.from(commercialPdf).toString('base64') }
      : null,
    packing_list: packing && packingPdf
      ? { document: packing.document, text: packing.text, pdf_base64: Buffer.from(packingPdf).toString('base64') }
      : null,
  };
}

async function assess(writer: Writer, request: Request) {
  const invoice = parseExportInvoice(await readJson(request));
  const setting = await readExportDocuments(writer);
  return assessExport(invoice, setting.value);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}
